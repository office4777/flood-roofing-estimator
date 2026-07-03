// CI gate for the sheet-layout engine.  Renders a matrix of L-shapes
// (8 proportions × 4 orientations + 2 mirrors) plus a few key sanity
// shapes through the production engine and ASSERTS clean coverage +
// the expected sheet counts.  Exits non-zero on any failure so a bad
// push / PR is blocked before it reaches production.
//
// Runs headless against floodroofing/frontend/index.html (which now
// pulls in sheet-plan.js).  Uses the bundled Playwright chromium in CI;
// set PW_CHROMIUM to override the executable locally.
const { chromium } = require('playwright');
const path = require('path');

const GAP_MAX = 1.5, OVER_MAX = 1.5;   // % — CLEAN threshold
const ox = 140, oy = 140;

const L = (ww, wh, mw, mh) => [[ox,oy],[ox+ww,oy],[ox+ww,oy+wh],[ox+mw,oy+wh],[ox+mw,oy+wh+mh],[ox,oy+wh+mh]];
const RECT = (w, h) => [[ox,oy],[ox+w,oy],[ox+w,oy+h],[ox,oy+h]];
const T = (cw, ch, sw, sh) => { const sx = ox + (cw-sw)/2; return [[ox,oy],[ox+cw,oy],[ox+cw,oy+ch],[sx+sw,oy+ch],[sx+sw,oy+ch+sh],[sx,oy+ch+sh],[sx,oy+ch],[ox,oy+ch]]; };

function orient(poly, k, mirror) {
  let xs = poly.map(p=>p[0]), ys = poly.map(p=>p[1]);
  const cx = (Math.min(...xs)+Math.max(...xs))/2, cy = (Math.min(...ys)+Math.max(...ys))/2;
  let out = poly.map(([x,y]) => { let dx=x-cx, dy=y-cy; for (let i=0;i<((k%4)+4)%4;i++){const nx=-dy,ny=dx;dx=nx;dy=ny;} if(mirror)dx=-dx; return [cx+dx,cy+dy]; });
  xs = out.map(p=>p[0]); ys = out.map(p=>p[1]);
  const mnx = Math.min(...xs), mny = Math.min(...ys);
  return out.map(([x,y]) => [x-mnx+ox, y-mny+oy]);
}

const PROPS = [
  ['Square wing',     [300,300,900,700]],
  ['Wide-wing',       [356,329,972,615]],
  ['Narrow tall',     [220,460,900,640]],
  ['Fat short',       [560,260,940,560]],
  ['Small wing',      [200,200,1000,820]],
  ['Big wing',        [460,420,720,520]],
  ['Near-square',     [340,340,760,760]],
  ['Long thin main',  [260,240,1080,420]],
];
const ORI = ['N','E','S','W'];

// Build the case list.  Each: { label, type, outline, expectSheets? }
const CASES = [];
PROPS.forEach(([name, p]) => ORI.forEach((o, k) =>
  CASES.push({ label: `L ${name} ${o}`, type: 'hip', outline: orient(L(...p), k, false) })));
CASES.push({ label: 'L Square wing MIRROR', type: 'hip', outline: orient(L(...PROPS[0][1]), 0, true) });
CASES.push({ label: 'L Wide-wing MIRROR',   type: 'hip', outline: orient(L(...PROPS[1][1]), 0, true) });
// Sanity anchors with a hard expected physical sheet count.
// Canonical Big-L physical-sheet anchor.  68 (was 70): the SOP
// complement-pairing pass merges the wing's valley-cut pieces into the
// wing-hip donor sheets they're physically cut from (one sheet = gutter
// piece + valley offcut), so two purple positions stopped being
// separately-ordered sheets.
CASES.push({ label: 'Canonical Big-L (count=68)', type: 'hip', outline: L(300,300,900,700), expectSheets: 68, checkPerColour: true });
CASES.push({ label: 'T-shape',                     type: 'hip', outline: T(900,260,300,460) });
CASES.push({ label: 'Simple hip 900x600',          type: 'hip', outline: RECT(900,600) });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const page = await (await browser.newContext()).newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'frontend', 'index.html'), { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const a=document.querySelector('.app'); if(a)a.style.display=''; const ls=document.getElementById('login-screen'); if(ls)ls.style.display='none'; });

  let failures = 0;
  for (const c of CASES) {
    let res;
    try {
      res = await page.evaluate(({ outline, type }) => {
        window.DRAW.sheetPlanDeletedIds = [];
        window.DRAW.outline = outline; window.DRAW.outlineDone = true;
        window.DRAW.scaleMetresPerPx = 0.02; window.DRAW.calPitch = 22;
        window.DRAW.lines = []; window.DRAW.roofs = []; window.DRAW.activeRoofIdx = -1;
        window.autoGenerateRoof(type);
        const card = document.getElementById('roofSheetPlanCard'); if (card) card.style.display = 'block';
        window.renderRoofSheetPlan();
        const all = window.__lastAllStrips || [];
        const inPoly = (x,y,p)=>{let s=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const xi=p[i][0],yi=p[i][1],xj=p[j][0],yj=p[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-10)+xi))s=!s;}return s;};
        const strips = all.map(s=>s.poly).filter(Boolean);
        const xs=outline.map(p=>p[0]),ys=outline.map(p=>p[1]);
        const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
        let tot=0,gap=0,over=0;
        for(let y=y0;y<=y1;y+=4)for(let x=x0;x<=x1;x+=4){if(!inPoly(x,y,outline))continue;tot++;let cc=0;for(let k=0;k<strips.length;k++){if(inPoly(x,y,strips[k])){cc++;if(cc>1)break;}}if(cc===0)gap++;else if(cc>1)over++;}
        const uniq={}, seqByCol={};
        all.forEach(s=>{ if(s.seq!=null){ uniq[s.color+'#'+s.seq]=1; (seqByCol[s.color]=seqByCol[s.color]||[]).push(s.seq); } });
        const perCol = {}; Object.keys(seqByCol).forEach(col=>{ const a=[...new Set(seqByCol[col])].sort((p,q)=>p-q); perCol[col] = (a[0]===1 && a[a.length-1]===a.length); });
        return { gap:(100*gap/tot), over:(100*over/tot), sheets:Object.keys(uniq).length, perColOk: Object.values(perCol).every(Boolean) };
      }, c);
    } catch (e) {
      console.log(`FAIL  ${c.label} — threw: ${e.message}`); failures++; continue;
    }
    const reasons = [];
    if (res.gap > GAP_MAX)  reasons.push(`gap ${res.gap.toFixed(1)}%`);
    if (res.over > OVER_MAX) reasons.push(`overlap ${res.over.toFixed(1)}%`);
    if (c.expectSheets && res.sheets !== c.expectSheets) reasons.push(`sheets ${res.sheets}≠${c.expectSheets}`);
    if (c.checkPerColour && !res.perColOk) reasons.push('per-colour not 1..N');
    if (reasons.length) { console.log(`FAIL  ${c.label} — ${reasons.join(', ')}`); failures++; }
    else console.log(`ok    ${c.label}  (${res.sheets} sheets, gap ${res.gap.toFixed(1)}% / over ${res.over.toFixed(1)}%)`);
  }

  if (jsErrors.length) { console.log(`\nFAIL  ${jsErrors.length} JS error(s): ${jsErrors.join(' | ')}`); failures++; }
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${CASES.length - failures}/${CASES.length} cases clean`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('runner error:', e); process.exit(2); });
