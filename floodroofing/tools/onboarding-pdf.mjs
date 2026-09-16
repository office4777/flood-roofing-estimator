// Turn the numbered captures into one A4 PDF, a screen per page.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const _ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(_ROOT, 'tools', 'out-onboarding');
const shots = JSON.parse(readFileSync(join(OUT, 'shots.json'), 'utf8'));
const sha = execSync('git rev-parse --short HEAD', { cwd: _ROOT }).toString().trim();
const when = new Date().toLocaleString('en-NZ', { dateStyle: 'long', timeStyle: 'short' });
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const b64 = f => 'data:image/png;base64,' + readFileSync(f).toString('base64');

// Group the run into the sections a reader thinks in.
const sectionOf = t =>
  /Sign-up page|Sign-in|password|Forgot/.test(t) ? 'Getting in'
  : /business up/.test(t) ? 'First sign-in'
  : /^Setup guide/.test(t) ? 'The setup guide'
  : /^Tutorial/.test(t) ? 'The tutorial'
  : 'Where it leaves you';

const pages = shots.map(s => `
  <section class="pg">
    <div class="hd">
      <div class="num">${s.n}</div>
      <div class="ttl">
        <div class="sec">${esc(sectionOf(s.title))}</div>
        <h2>${esc(s.title)}</h2>
        ${s.note ? `<p>${esc(s.note)}</p>` : ''}
      </div>
    </div>
    <div class="shot"><img src="${b64(s.file)}"></div>
  </section>`).join('');

const contents = ['Getting in','First sign-in','The setup guide','The tutorial','Where it leaves you']
  .map(sec => {
    const inSec = shots.filter(s => sectionOf(s.title) === sec);
    if (!inSec.length) return '';
    return `<div class="toc-sec"><h3>${esc(sec)} <span>${inSec[0].n}–${inSec[inSec.length-1].n}</span></h3><ol>` +
      inSec.map(s => `<li><b>${s.n}</b> ${esc(s.title)}</li>`).join('') + '</ol></div>';
  }).join('');

const html = `<!doctype html><meta charset="utf-8"><style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, 'Segoe UI', Inter, sans-serif; color:#0a1628; }
  .pg { width:210mm; height:297mm; padding:12mm 12mm 10mm; page-break-after:always; display:flex; flex-direction:column; }
  .hd { display:flex; gap:9mm; align-items:flex-start; border-bottom:1.2pt solid #0a1628; padding-bottom:4mm; margin-bottom:5mm; }
  .num { font-size:30pt; font-weight:800; line-height:1; color:#0099cc; min-width:20mm; }
  .sec { font-size:7.5pt; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:#7c3aed; margin-bottom:1.5mm; }
  .ttl h2 { font-size:14pt; margin:0 0 1.5mm; letter-spacing:-.01em; }
  .ttl p { font-size:9pt; margin:0; color:#475569; line-height:1.45; }
  .shot { flex:1; display:flex; align-items:flex-start; justify-content:center; }
  .shot img { max-width:100%; max-height:100%; border:0.8pt solid #cbd5e1; border-radius:2mm; }
  .cover { width:210mm; height:297mm; padding:26mm 20mm; page-break-after:always; }
  .cover h1 { font-size:30pt; margin:0 0 3mm; letter-spacing:-.02em; }
  .cover .sub { font-size:12pt; color:#475569; margin:0 0 10mm; }
  .meta { font-size:9.5pt; color:#475569; line-height:1.7; border-top:1pt solid #cbd5e1; border-bottom:1pt solid #cbd5e1; padding:5mm 0; margin-bottom:8mm; }
  .meta b { color:#0a1628; }
  .warn { background:#fffbeb; border:1pt solid #f59e0b; border-radius:2mm; padding:5mm; font-size:9.5pt; line-height:1.6; color:#78350f; }
  .warn b { display:block; margin-bottom:2mm; color:#78350f; }
  .toc { width:210mm; min-height:297mm; padding:18mm 20mm; page-break-after:always; }
  .toc h1 { font-size:17pt; margin:0 0 6mm; }
  .toc-sec { margin-bottom:6mm; break-inside:avoid; }
  .toc-sec h3 { font-size:10pt; margin:0 0 2mm; text-transform:uppercase; letter-spacing:.08em; color:#7c3aed; }
  .toc-sec h3 span { color:#94a3b8; font-weight:500; letter-spacing:0; text-transform:none; }
  .toc ol { margin:0; padding:0; list-style:none; columns:2; column-gap:10mm; }
  .toc li { font-size:9pt; padding:0.8mm 0; color:#334155; break-inside:avoid; }
  .toc li b { color:#0099cc; display:inline-block; min-width:7mm; }
</style>
<div class="cover">
  <h1>RoofMap onboarding</h1>
  <p class="sub">Every screen a new account meets, first sign-in to finished.</p>
  <div class="meta">
    <div><b>Screens:</b> ${shots.length}, numbered in the order they appear</div>
    <div><b>Captured:</b> ${esc(when)}</div>
    <div><b>Build:</b> ${esc(sha)} — the live app, driven in a real browser</div>
    <div><b>Viewport:</b> 1440 × 1100, desktop</div>
  </div>
  <div class="warn">
    <b>Two things this cannot show</b>
    Aerial imagery does not load on the machine that captured this, so every screen
    that would show a satellite photo shows the empty map frame instead. The API is
    answered locally as a brand-new trial account with no jobs, no price book and no
    branding — which is the point, but it means no real job data appears anywhere.
  </div>
</div>
<div class="toc"><h1>What is in here</h1>${contents}</div>
${pages}`;

const file = join(OUT, 'RoofMap-onboarding-audit.pdf');
const b = await chromium.launch();
const pg = await (await b.newContext()).newPage();
await pg.setContent(html, { waitUntil: 'load' });
await pg.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close();
console.log(file);
