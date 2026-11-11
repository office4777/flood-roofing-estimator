// Feedback reports 89 and 90 (2026-11-11), one roof drawn two ways:
//   89 "the gable + hip & valley is broken, it should just be the same as a
//       normal hip and valley, except the 3x ends are converted to gable ends"
//   90 "how it should look after i made it a normal hip&valley with me
//       manually converted the ends to gable ends"
// Past a square L, Gable + hip & valley is the hip roof (bumps and all) with
// every hip end made a gable. The old path (the rectilinear builder) ran a
// hip corner to corner across the main roof and a barge through it.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { chromium } from 'playwright';
const DIR = _j(_d(_f(import.meta.url)), '..', 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const OL = [[1052,570],[1052,688],[1395,688],[1395,538],[1343,538],[1343,490],[1195,490],[1195,538],[1167,538],[1167,570]];
// Report 90's structure — the hip roof with the three ends gabled by hand.
const WANT = [
  'barge 1052,570>1052,629', 'barge 1052,629>1052,688', 'barge 1195,490>1269,490', 'barge 1269,490>1343,490',
  'barge 1395,538>1395,613', 'barge 1395,613>1395,688',
  'hip 1167,538>1242,613', 'hip 1227,629>1242,613',
  'ridge 1052,629>1227,629', 'ridge 1242,613>1395,613', 'ridge 1269,490>1269,612',
  'valley 1167,570>1227,629', 'valley 1195,538>1269,612', 'valley 1269,612>1343,538'];
const T = [[140,140],[1040,140],[1040,400],[740,400],[740,860],[440,860],[440,400],[140,400]];

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport:{ width:1400, height:950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.route('**/api.mapbox.com/**', r => r.abort());
await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }));
await pg.addInitScript(() => { localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); localStorage.setItem('fr_settings','null'); localStorage.setItem('fr_site_mode','off'); });
await pg.goto('file://' + DIR + '/app.html');
await pg.waitForTimeout(2600);

const ord = (pts) => pts.map(p => p.map(Math.round)).sort((a, c) => a[0] - c[0] || a[1] - c[1]);
const S = (lines) => lines.filter(l => l.type !== 'gutter').map(l => l.type + ' ' + ord(l.pts).map(p => p.join(',')).join('>')).sort();
function sameRoof(A, B){
  const parse = s => { const [t, ab] = s.split(' '); return { t, p: ab.split('>').map(q => q.split(',').map(Number)) }; };
  if (A.length !== B.length) return false;
  const left = B.map(parse);
  return A.map(parse).every(a => {
    const i = left.findIndex(c => c.t === a.t && c.p.every((q, k) => Math.abs(q[0] - a.p[k][0]) <= 1 && Math.abs(q[1] - a.p[k][1]) <= 1));
    if (i < 0) return false; left.splice(i, 1); return true;
  });
}
const build = (ol, type, bumps, ek) => pg.evaluate(([ol, type, bumps, ek]) => {
  gotoTab('roof'); clearAll(true);
  DRAW.outline = ol.map(p => p.slice()); DRAW.lines = []; DRAW.scaleMetresPerPx = 0.0222; DRAW.calPitch = 15;
  DRAW.bumpModes = bumps || {}; DRAW.endKinds = ek || null; DRAW.rotation = 0;
  autoGenerateRoof(type);
  document.querySelectorAll('#_rsModal,.rs-drop').forEach(e => e.remove());
  return DRAW.lines.map(l => ({ type: l.type, pts: l.pts }));
}, [ol, type, bumps, ek]);

let L = await build(OL, 'gable-hv', { 5: 'hv' });
let got = S(L);
check('Gable + hip & valley on report 89’s roof is the hip roof with its three ends gabled — report 90’s lines', sameRoof(got, WANT.slice().sort()), got.join(' | '));
check('…no hip runs corner to corner across the main roof', !got.some(s => /^hip 1052,570>1226|^hip 1052,570>1227/.test(s)), got.filter(s => /^hip/.test(s)).join(' | '));
check('…and no barge runs through it', !got.some(s => /^barge 1052,613>1167,538/.test(s)), got.filter(s => /^barge/.test(s)).join(' | '));
// endKinds are cleared by a new shape, so the hand conversion is asked of the builders directly.
const direct = (fn, ek) => pg.evaluate(([OL, fn, ek]) => { DRAW.outline = OL.map(p => p.slice()); DRAW.bumpModes = { 5: 'hv' }; DRAW.endKinds = ek;
  const out = (fn === 'hip' ? _hipLinesWithEnds(OL) : _gableHvLines(OL, 0)).map(l => ({ type: l.type, pts: l.pts })); DRAW.endKinds = null; return out; }, [OL, fn, ek]);
let H = await direct('hip', { 'e:0-1': 'gable', 'e:2-3': 'gable', 'e:5-6': 'gable' });
check('…exactly what the hip roof with the ends converted by hand draws', sameRoof(got, S(H)), S(H).join(' | '));
L = await direct('hv', { 'e:2-3': 'hip' });
got = S(L);
check('an end the office set back to a hip stays a hip', got.filter(s => /^hip/.test(s)).length === 4 && got.filter(s => /^barge/.test(s)).length === 4, got.join(' | '));
// The T he passed and the L of reports 17-20 are unchanged.
const tOld = await pg.evaluate((T) => buildGableRoofLines_legacy(T).map(l => ({ type: l.type, pts: l.pts })), T);
const tNew = await build(T, 'gable-hv');
check('the hip T is line for line what it was', sameRoof(S(tNew), S(tOld)), S(tNew).join(' | '));
const R17 = [[443,131],[443,532],[979,532],[979,235],[779,235],[779,131]];
const lOld = await pg.evaluate((o) => _gableHvL(o).map(l => ({ type: l.type, pts: l.pts })), R17);
const lNew = await build(R17, 'gable-hv');
check('the L of reports 17-20 keeps its own rule', sameRoof(S(lNew), S(lOld)), S(lNew).join(' | '));
check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
