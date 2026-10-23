// Feedback reports 17, 18, 19 and 20 (2026-10-23), four roofs the owner drew
// in one sitting, all on the same job.
//
//   17 "gable + hip & valley corner wrong, missing a valley"
//   19 "gable + hip&valley roof drawing is wrong, closing the shape up
//       slightly breaks it"
//   20 "there should be another small hip on the bottom side of the
//       horizontal ridge which breaks up the vertical ridge and then there
//       should be another valley too"
//   18 "Step-down gable is wrong, the length of the apron should only the the
//       same length as the barge on the very far right barge (at the top)"
//
// The first three are one roof: an L whose arms are not the same width. The
// NARROWER arm runs straight through to a gable on the outside wall at both
// ends; the WIDER arm stops at the corner in a hip end in the same plane as
// the narrow arm's far slope. 17 had lost the valley on the outside of that
// hip end; 19 (the wing drawn wider than the main is deep) threw two hips
// corner to corner across the wing; 20 (a narrow arm over a wide one) ran the
// narrow ridge clean through the wide arm to the far wall. An L with arms the
// same width is the classic corner — ridges meeting, a valley in and a hip
// out — and stays exactly as it was.
//
// 18 is the step-down gable's apron, left open on 2026-10-13 and answered
// here: it runs only where the wider roof stands above the lower one.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// The outlines exactly as the reports printed them.
const R17 = [[443,131],[443,532],[979,532],[979,235],[779,235],[779,131]];
const R18 = [[443,131],[443,527],[1101,527],[1101,256],[779,256],[779,131]];
const R19 = [[443,220],[443,480],[964,480],[964,390],[680,390],[680,220]];
const R20 = [[395,220],[395,756],[1047,756],[1047,390],[680,390],[680,220]];

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

// One builder call: the lines as sorted "type a>b" strings, rounded.
// Points sorted by number, not as text ("1047" sorts before "578" as text).
const ord = (pts) => pts.map(p => p.map(Math.round)).sort((a, c) => a[0] - c[0] || a[1] - c[1]);
const S = (lines) => lines.map(l => l.type + ' ' + ord(l.pts).map(p => p.join(',')).join('>')).sort();
// The same roof to a pixel: a half-pixel corner rounds either way when mirrored.
function sameRoof(A, B){
  const parse = s => { const [t, ab] = s.split(' '); return { t, p: ab.split('>').map(q => q.split(',').map(Number)) }; };
  if (A.length !== B.length) return false;
  const left = B.map(parse);
  return A.map(parse).every(a => {
    const i = left.findIndex(c => c.t === a.t && c.p.every((q, k) => Math.abs(q[0] - a.p[k][0]) <= 1 && Math.abs(q[1] - a.p[k][1]) <= 1));
    if (i < 0) return false; left.splice(i, 1); return true;
  });
}
async function hv(ol){ return pg.evaluate((ol) => buildGableRoofLines_legacy(ol).map(l => ({ type:l.type, subtype:l.subtype, pts:l.pts })), ol); }
const has = (arr, s) => arr.includes(s);

// ── 17: the wide arm over a narrow one ─────────────────────────────────
const a17 = S(await hv(R17));
check('17: the valley on the OUTSIDE of the hip end is drawn — from the west wall, level with the inside corner',
  has(a17, 'valley 443,235>592,384'), JSON.stringify(a17));
check('17: …beside the one from the inside corner, which was always there',
  has(a17, 'valley 631,384>779,235'));
check('17: the wide arm hips at the corner, its two hips down to the narrow ridge',
  has(a17, 'hip 592,384>611,364') && has(a17, 'hip 611,364>631,384') && has(a17, 'ridge 611,131>611,364'));
check('17: the narrow arm gables on the west wall from the inside corner\'s level down — not from the top',
  has(a17, 'barge 443,235>443,384') && has(a17, 'barge 443,384>443,532') && !a17.some(s => s.startsWith('barge 443,131>443')), JSON.stringify(a17.filter(s => s.startsWith('barge'))));
check('17: two valleys, two hips, three ridges', a17.filter(s => s.startsWith('valley')).length === 2
  && a17.filter(s => s.startsWith('hip')).length === 2 && a17.filter(s => s.startsWith('ridge')).length === 3);

// ── 19: the wing drawn wider than the main is deep ─────────────────────
const a19 = S(await hv(R19));
check('19: no hip runs corner to corner across the wing any more',
  !a19.some(s => s.startsWith('hip 443,220') || s.startsWith('hip 465,435')), JSON.stringify(a19));
check('19: the wing ridge comes down to its hip end, two short hips onto the main ridge',
  has(a19, 'ridge 562,220>562,362') && has(a19, 'hip 488,435>562,362') && has(a19, 'hip 562,362>635,435'), JSON.stringify(a19));
check('19: a valley each side of the hip end', has(a19, 'valley 443,390>488,435') && has(a19, 'valley 635,435>680,390'));
check('19: the main ridge runs out to both gables either side of it', has(a19, 'ridge 443,435>488,435') && has(a19, 'ridge 635,435>964,435'));

// ── 20: a narrow arm over a wide one ───────────────────────────────────
const a20 = S(await hv(R20));
check('20: THE VERTICAL RIDGE IS BROKEN UP — it stops at the wide arm\'s north slope …',
  has(a20, 'ridge 538,220>538,533') && !a20.some(s => /^ridge 538,220>538,756/.test(s)), JSON.stringify(a20));
check('20: … and comes out again below its south slope to the bottom gable', has(a20, 'ridge 538,614>538,756'));
check('20: ANOTHER SMALL HIP on the bottom side of the horizontal ridge, beside the one above it',
  has(a20, 'hip 538,533>578,573') && has(a20, 'hip 538,614>578,573'));
check('20: AND ANOTHER VALLEY, from the bottom wall up to it', has(a20, 'valley 538,614>680,756') && has(a20, 'valley 538,533>680,390'));
check('20: the horizontal ridge starts at the wide arm\'s hip end', has(a20, 'ridge 578,573>1047,573'));
check('20: the bottom gable is the narrow arm\'s own width, not run across the wide arm',
  has(a20, 'barge 395,756>538,756') && has(a20, 'barge 538,756>680,756') && !a20.some(s => s.includes('974,756')), JSON.stringify(a20.filter(s => s.startsWith('barge'))));

// ── the same roof any way round ────────────────────────────────────────
const flip = (ol, fx, fy) => ol.map(p => [fx ? 2000 - p[0] : p[0], fy ? 2000 - p[1] : p[1]]);
for (const [name, ol] of [['17', R17], ['20', R20]]){
  const base = S(await hv(ol));
  for (const [fx, fy] of [[1,0],[0,1],[1,1]]){
    const got = S(await hv(flip(ol, fx, fy)));
    const back = S(got.map(s => { const [t, ab] = s.split(' '); return { type:t, pts: ab.split('>').map(q => q.split(',').map(Number)) }; })
      .map(l => ({ type:l.type, pts: flip(l.pts, fx, fy) })));
    check(name + ' mirrored (' + (fx ? 'x' : '') + (fy ? 'y' : '') + ') is the same roof mirrored', sameRoof(back, base), JSON.stringify(back));
  }
}
const rot = R20.map(p => [p[1], p[0]]);
const aRot = S(await hv(rot));
check('20 turned on its side is the wide-over-narrow roof: one ridge to a hip end, two short hips, two valleys',
  aRot.filter(s => s.startsWith('hip')).length === 2 && aRot.filter(s => s.startsWith('valley')).length === 2, JSON.stringify(aRot));

// ── an L with equal arms is untouched, and so is one a few pixels off ──
const eq = S(await hv([[0,0],[400,0],[400,300],[900,300],[900,700],[0,700]]));
check('an L with equal arms is the classic corner, exactly as before',
  JSON.stringify(eq) === JSON.stringify(['barge 0,0>200,0','barge 200,0>400,0','barge 900,300>900,500','barge 900,500>900,700',
    'hip 0,700>200,500','ridge 200,0>200,500','ridge 200,500>900,500','valley 200,500>400,300']), JSON.stringify(eq));
const near = S(await hv([[0,0],[400,0],[400,300],[900,300],[900,710],[0,710]]));
check('…and one drawn ten pixels out is the classic corner too, not a ridge run through to the far wall',
  near.filter(s => s.startsWith('hip')).length === 1 && has(near, 'hip 0,710>200,505') && !near.some(s => s.includes('200,710')), JSON.stringify(near));
const ends = await hv([[0,0],[400,0],[400,300],[900,300],[900,700],[0,700]]);
check('each gable end is a starter and a finish, nearer foot first, as the square-walled builder tags them',
  ends.filter(l => l.type === 'barge').map(l => l.subtype).join() === 'starter,finish,starter,finish', JSON.stringify(ends.filter(l => l.type === 'barge')));
check('a T is not an L and keeps its own builder',
  (await hv([[0,0],[900,0],[900,300],[650,300],[650,700],[250,700],[250,300],[0,300]])).length > 0);

// ── 17 laid out by the app: gutters fill the walls the barges leave ────
const app17 = await pg.evaluate((OL) => {
  gotoTab('roof'); clearAll(true); setTool('outline');
  DRAW.currentPts = OL.map(p => p.slice()); finishCurrent();
  DRAW.scaleMetresPerPx = 0.02; DRAW.calPitch = 25; DRAW.roofType = 'gable-hv';
  autoGenerateRoof('gable-hv', 0); autoCalcLineMeasurements(); renderRoofSheetPlan();
  const gg = (window._lastSheetCounts || {}).groups || {};
  let tot = 0; Object.keys(gg).forEach(k => tot += gg[k].count);
  return { gut: DRAW.lines.filter(l => l.type === 'gutter').map(l => l.pts.map(p => p.map(Math.round).join(',')).sort().join('>')).sort(),
           types: DRAW.lines.reduce((a, l) => { a[l.type] = (a[l.type] || 0) + 1; return a; }, {}), sheets: tot };
}, R17);
check('17 in the app: the west wall above the narrow arm is a gutter (it was a barge)', app17.gut.includes('443,131>443,235'), JSON.stringify(app17.gut));
check('17 in the app: the sheet engine sheets it', app17.sheets > 0, JSON.stringify(app17));

// ── 18: the step-down gable's apron ────────────────────────────────────
const a18 = await pg.evaluate((OL) => { DRAW.roofBaseHoriz = true;
  return buildStepGableRoofLines(OL, false).filter(l => l.type === 'apron' || l.type === 'barge')
    .map(l => l.type + ' ' + l.pts.map(p => p.map(Math.round)).sort((a, c) => a[0] - c[0] || a[1] - c[1]).map(p => p.join(',')).join('>')).sort(); }, R18);
check('18: THE APRON IS THE SAME LENGTH AS THE TOP-RIGHT BARGE — the wing\'s gutter up to its ridge',
  a18.includes('apron 779,256>779,392') && a18.includes('barge 1101,256>1101,392'), JSON.stringify(a18));
check('18: below the wing\'s ridge the two roofs are one plane, so nothing runs on to the shared gutter',
  !a18.some(s => s.startsWith('apron') && s.includes('527')), JSON.stringify(a18));
check('18: the junction barge is still ridge to ridge', a18.includes('barge 779,329>779,392'));
const tee = await pg.evaluate(() => { DRAW.roofBaseHoriz = true;
  return buildStepGableRoofLines([[0,0],[600,0],[600,100],[900,100],[900,300],[600,300],[600,400],[0,400]], false)
    .filter(l => l.type === 'apron').map(l => l.pts.map(p => p.map(Math.round).join(',')).sort().join('>')); });
check('18: a low block standing in the middle of a tall one shares no gutter, so its apron is still the whole stretch',
  JSON.stringify(tee) === '["600,100>600,300"]', JSON.stringify(tee));

check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter(x => !x).length;
console.log(failed ? (failed + ' of ' + results.length + ' FAILED') : ('all ' + results.length + ' passed'));
process.exit(failed ? 1 : 0);
