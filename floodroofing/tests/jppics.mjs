// THE JOB PACK'S DIAGRAMS ARE PICTURES THAT TURN (2026-11-06, the owner:
// "can you also add a rotate 90deg button on this picture in the job pack,
// also the next two diagrams (sheet layout and sheet pre-cut) can you put them
// in picture form too so i can move and edit them, exactly as i can with the
// detailed map at the top (but with the new rotate buttons) and make them
// default fit to page just like they do now").
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { chromium } from 'playwright';
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1600, height:1100 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2800);

// An 18 x 12 m hip, wider than tall, so the app's own turn applies.
await pg.evaluate(async () => {
  gotoTab('roof');
  DRAW.roofs = []; DRAW.activeRoofIdx = -1; DRAW.showAllRoofs = true;
  DRAW.scaleMetresPerPx = 0.05; DRAW.calPitch = 25;
  DRAW.outline = [[140,140],[500,140],[500,380],[140,380]]; DRAW.outlineDone = true; DRAW.lines = [];
  autoGenerateRoof('hip'); try { autoCalcLineMeasurements(); fitDrawingToCanvas(); redrawAll(); } catch(e){}
  renderRoofSheetPlan();
  S.jobPack = null; gotoTab('materials'); renderJobPack();
  await new Promise(r => setTimeout(r, 900));
});

const read = () => pg.evaluate(() => {
  const pages = [...document.querySelectorAll('#jpPages .jp-page')];
  const one = (p, sel) => { const w = p && p.querySelector(sel); if (!w) return null; const img = w.querySelector('img');
    const pr = p.getBoundingClientRect(), wr = w.getBoundingClientRect();
    return { nw: img.naturalWidth, nh: img.naturalHeight, rot: !!w.querySelector('.jp-rot-btn'), crop: /Crop/.test(w.textContent), edit: /Edit/.test(w.textContent),
             inside: wr.top >= pr.top - 1 && wr.bottom <= pr.bottom + 1 && wr.left >= pr.left - 1 && wr.right <= pr.right + 1,
             fill: Math.round(100 * Math.max(wr.width / pr.width, wr.height / pr.height)), cls: img.className, id: w.getAttribute('data-img-id') }; };
  const st = _jpState().pages;
  return { types: st.map(p => p.type).join(','),
           map: one(pages[0], '.jp-page-imgwrap'), sl: one(pages[1], '.jp-page-imgwrap'), pc: one(pages[2], '.jp-page-imgwrap'),
           slIm: (st[1].images || [])[0] || null, pcIm: (st[2].images || [])[0] || null };
});
let v = await read();
check('the sheet layout and the pre-cut layout are pictures on their pages, like the detailed map — Crop, Edit and ⟳ 90° on each',
  v.types.startsWith('header,sheetplan,precut,') && v.sl && v.pc && v.map && [v.map, v.sl, v.pc].every(x => x.rot && x.crop && x.edit) &&
  v.sl.cls === 'jp-sl-img' && v.pc.cls === 'jp-precut-img', JSON.stringify(v));
check('…fitted to the page by default, as the pages were (the sheet layout turned upright on a wide roof)',
  v.sl.inside && v.pc.inside && v.sl.fill >= 75 && v.pc.fill >= 75 && v.sl.nh > v.sl.nw && v.pc.nh > v.pc.nw, JSON.stringify([v.sl, v.pc]));

// ⟳ 90° on the pre-cut: the picture itself turns (so the PDF does too) and is fitted again.
const pc0 = v.pc;
await pg.evaluate(() => { const w = document.querySelectorAll('#jpPages .jp-page')[2].querySelector('.jp-rot-btn'); w.click(); });
await pg.waitForTimeout(700);
v = await read();
check('⟳ 90° turns the pre-cut picture a quarter — the picture is drawn turned, still fitted inside its page',
  v.pcIm.rot === 90 && v.pc.nw === pc0.nh && v.pc.nh === pc0.nw && v.pc.inside, JSON.stringify([pc0, v.pc, v.pcIm]));
await pg.evaluate(() => { for (let i = 0; i < 3; i++){ const w = document.querySelectorAll('#jpPages .jp-page')[2].querySelector('.jp-rot-btn'); w.click(); } });
await pg.waitForTimeout(900);
v = await read();
check('…four presses bring it back to where it started', !v.pcIm.rot && v.pc.nw === pc0.nw && v.pc.nh === pc0.nh, JSON.stringify([v.pc, v.pcIm]));

// The detailed map: moved by hand, then turned — it keeps its centre and its turn.
const map0 = v.map;
const moved = await pg.evaluate(async () => {
  const page = _jpState().pages[0], im = page.images[0];
  const wrap = document.querySelector('#jpPages .jp-page .jp-page-imgwrap');
  const r = wrap.getBoundingClientRect();
  const fire = (t, x, y) => (t === 'mousedown' ? wrap : document).dispatchEvent(new MouseEvent(t, { clientX: x, clientY: y, bubbles: true }));
  fire('mousedown', r.left + 60, r.top + 60); fire('mousemove', r.left + 20, r.top + 40); fire('mouseup', r.left + 20, r.top + 40);
  await new Promise(r2 => setTimeout(r2, 100));
  const before = { x: im.x, y: im.y, w: im.w, h: im.h, user: !!im.userSized, kept: im.turnKept };
  _jpRotateImage(0, im.id);
  await new Promise(r2 => setTimeout(r2, 700));
  const im2 = _jpState().pages[0].images[0];
  return { before, after: { x: im2.x, y: im2.y, w: im2.w, h: im2.h, rot: im2.rot } };
});
v = await read();
const cx = o => o.x + o.w / 2, cy = o => o.y + o.h / 2;
check('a moved picture stays as it was turned (the app\'s own wide-roof turn is kept once the office moves it)',
  moved.before.user && moved.before.kept === true, JSON.stringify(moved));
check('…and ⟳ 90° turns it as it stands, its width and height swapped (brought down to fit the page if it must) and still on the page',
  moved.after.rot === 90 && Math.abs(moved.after.w / moved.after.h - moved.before.h / moved.before.w) < 0.02 &&
  v.map.inside && v.map.nw === map0.nh && v.map.nh === map0.nw, JSON.stringify([moved, map0, v.map]));

// The sheet layout's picture can be deleted, and the page is not given it back.
v = await pg.evaluate(async () => {
  const st = _jpState().pages[1]; _jpDeleteImage(1, st.images[0].id);
  await new Promise(r => setTimeout(r, 300)); renderJobPack(); await new Promise(r => setTimeout(r, 300));
  return { n: (_jpState().pages[1].images || []).length, pic: _jpState().pages[1].pic };
});
check('deleting the sheet layout picture leaves its page empty — it is not put back', v.n === 0 && v.pic === true, JSON.stringify(v));

// The Basic map (an SVG) turns too.
v = await pg.evaluate(async () => {
  const a = _jpCaptureMap('basic', {}), c = _jpCaptureMap('basic', { rot: 90 });
  const dims = src => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.onerror = () => r(null); i.src = src; });
  return { a: await dims(a), c: await dims(c) };
});
check('the Basic map turns as well', v.a && v.c && Math.abs(v.a[0] / v.a[1] - v.c[1] / v.c[0]) < 0.02, JSON.stringify(v));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
