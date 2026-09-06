// Assembles tools/demo/shots/*.png into one self-contained slideshow —
// tools/demo/slideshow.html, images inlined as data URIs so the file can be
// published or emailed with nothing else beside it.
//
//   node floodroofing/tools/demo-shots.mjs      # capture first
//   node floodroofing/tools/demo-slideshow.mjs  # then assemble
//
// The captions and timings live in SLIDES below — that array is the script
// of the demo, and the place to change the wording or the pacing.
//
// Aerial frames come from Aron's own machine: Mapbox is unreachable from
// the build environment, so any slide whose file is missing renders as a
// labelled placeholder rather than being dropped. The deck can be reviewed
// and timed before those arrive.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile, access } from 'node:fs/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'demo', 'shots');
const OUT = join(HERE, 'demo', 'slideshow.html');

// file: a PNG in shots/, or null for a title card. secs: how long it holds.
const SLIDES = [
  { card:'title', secs:5,
    title:'RoofMap', sub:'Measure. Price. Quote. Order.',
    foot:'A roof, start to finish, in one afternoon' },

  { file:'01-home-board.png', secs:8, title:'Every job, one board',
    body:'Drafts, quotes sent, questions, declines, acceptances, orders. You can see what is waiting on you without opening anything.' },

  { need:'aerial-found', secs:7, title:'Type the address',
    body:'RoofMap pulls the aerial photo and sets the scale from it. No tape, no ladder, no guessing off a plan.' },

  { need:'aerial-trace', secs:7, title:'Trace the outline',
    body:'Click the corners of the building. Every line you draw is measured as you go.' },

  { need:'aerial-lines', secs:8, title:'The roof works itself out',
    body:'Ridges, hips, valleys and gutters, generated from the outline and the pitch — not drawn by hand.' },

  { file:'02-roof-measured.png', secs:9, title:'Real measurements',
    body:'Every ridge, hip, valley and gutter run in metres, off the photo. This is what the material list and the price are built from.' },

  { file:'03-sheet-plan.png', secs:9, title:'The sheets, laid out',
    body:'How the roof actually gets covered, and the count you order to — here 14 at 3.84 m and 41 at 4.25 m.' },

  { file:'04-cut-list.png', secs:7, title:'A cut list for the crew',
    body:'Every sheet, every length, numbered to match the plan.' },

  { file:'05-roof-map.png', secs:7, title:'Flashings and fixings',
    body:'The roof map the boys work off on site — each run referenced, so nobody is measuring twice.' },

  { file:'07-pricing-panel.png', secs:8, title:'Your rates, not ours',
    body:'Scaffolding, labour, materials — your supplier prices and your hourly rates, with cost and sell side by side.' },

  { file:'08-pricing-labour.png', secs:8, title:'Labour and margin, visible',
    body:'Hours by role, cost per hour, price per hour. You see the margin before the customer sees the price.' },

  { file:'10-quote-cover.png', secs:9, title:'The quote — under your name',
    body:'Your logo, your fleet, your accreditations. Six pages that read like a proposal, not a spreadsheet.' },

  { file:'11-quote-options.png', secs:9, title:'The customer picks',
    body:'Steel grade, gauge, colour, guttering, and anything else you sell. The total moves as they choose — no re-quoting.' },

  { file:'12-quote-accept.png', secs:9, title:'They accept online',
    body:'Signed off from the phone. The deposit figure is on the page, and the job lands back in your list accepted.' },

  { file:'06-job-pack.png', secs:8, title:'A pack for the crew',
    body:'The job pack builds itself from the same measurements — nothing retyped, nothing to get out of step.' },

  { file:'13-schedule.png', secs:9, title:'On the board',
    body:'An accepted quote goes straight onto the schedule. Pencil it in, or book a crew — the length paints itself around weekends and holidays.' },

  { file:'09-invoices.png', secs:7, title:'Deposit, progress, final',
    body:'Invoices raised off the accepted total, so the deposit goes out the day they say yes.' },

  { card:'end', secs:6, title:'roofmap.co.nz',
    sub:'Start free — 14 days, no card',
    foot:'Or book a 15-minute setup call and we load your rates with you' },
];

async function dataUri(name) {
  const p = join(SHOTS, name);
  try { await access(p); } catch { return null; }
  return 'data:image/png;base64,' + (await readFile(p)).toString('base64');
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const built = [];
const missing = [];
for (const s of SLIDES) {
  const src = s.file ? await dataUri(s.file) : null;
  if (s.file && !src) missing.push(s.file);
  if (s.need) missing.push(s.need + ' (from Aron)');
  built.push({ ...s, src });
}

const total = SLIDES.reduce((a, s) => a + s.secs, 0);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RoofMap — a two-minute look</title>
<style>
  :root{ --ink:#0a1628; --accent:#0099cc; --paper:#f7f5ef; }
  *{ box-sizing:border-box }
  html,body{ margin:0; height:100%; background:var(--ink); color:#fff;
    font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; overflow:hidden }
  #stage{ position:relative; width:100vw; height:100vh; overflow:hidden }
  .slide{ position:absolute; inset:0; opacity:0; transition:opacity .7s ease;
    display:grid; grid-template-columns:1fr 30%; align-items:center; gap:0 }
  .slide.on{ opacity:1 }
  .shot{ height:100%; display:flex; align-items:center; justify-content:center;
    padding:3.5vh 2vw; overflow:hidden; background:var(--ink) }
  .shot img{ max-width:100%; max-height:100%; object-fit:contain;
    border-radius:10px; box-shadow:0 22px 70px rgba(0,0,0,.55);
    animation:drift 14s ease-out both }
  @keyframes drift{ from{ transform:scale(1.035) } to{ transform:scale(1) } }
  .cap{ padding:0 4vw 0 1vw }
  .cap h2{ font-size:clamp(20px,2.3vw,36px); line-height:1.15; margin:0 0 14px; letter-spacing:-.02em }
  .cap p{ font-size:clamp(13px,1.05vw,18px); line-height:1.55; margin:0; color:#c3d2e0 }
  .cap .rule{ width:52px; height:4px; background:var(--accent); border-radius:2px; margin:0 0 20px }
  /* Title / end cards fill the frame instead of splitting it. */
  .slide.card{ grid-template-columns:1fr; text-align:center; place-items:center }
  .slide.card .cap{ padding:0 8vw }
  .slide.card h1{ font-size:clamp(40px,7vw,110px); margin:0 0 10px; letter-spacing:-.04em }
  .slide.card .sub{ font-size:clamp(18px,2.4vw,38px); color:var(--accent); font-weight:600; margin:0 0 18px }
  .slide.card .foot{ font-size:clamp(13px,1.2vw,20px); color:#9fb3c6 }
  .todo{ display:flex; align-items:center; justify-content:center; height:100%;
    margin:3.5vh 2vw; border:2px dashed #33506b; border-radius:12px; color:#7d97ae;
    font-size:clamp(13px,1.2vw,19px); text-align:center; padding:20px; line-height:1.5 }
  #bar{ position:fixed; left:0; bottom:0; height:4px; background:var(--accent); width:0; z-index:5 }
  #hint{ position:fixed; right:16px; bottom:14px; font-size:12px; color:#61798f; z-index:5 }
  @media (max-width:820px){
    .slide{ grid-template-columns:1fr; grid-template-rows:1fr auto; align-content:center }
    .cap{ padding:0 6vw 5vh }
  }
</style>
</head>
<body>
<div id="stage">
${built.map((s, i) => {
  if (s.card) return `  <section class="slide card" data-secs="${s.secs}">
    <div class="cap">
      <h1>${esc(s.title)}</h1>
      <p class="sub">${esc(s.sub || '')}</p>
      <p class="foot">${esc(s.foot || '')}</p>
    </div>
  </section>`;
  const pic = s.src
    ? `<div class="shot"><img src="${s.src}" alt="${esc(s.title)}"></div>`
    : `<div class="shot"><div class="todo">${esc(s.title)}<br><small>screenshot to come — ${esc(s.need || s.file)}</small></div></div>`;
  return `  <section class="slide" data-secs="${s.secs}">
    ${pic}
    <div class="cap"><div class="rule"></div><h2>${esc(s.title)}</h2><p>${esc(s.body || '')}</p></div>
  </section>`;
}).join('\n')}
</div>
<div id="bar"></div>
<div id="hint">click or press space to pause · ← → to step</div>
<script>
(function(){
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var bar = document.getElementById('bar');
  var i = 0, t0 = 0, held = 0, paused = false, raf = 0;
  var total = slides.reduce(function(a,s){ return a + (+s.dataset.secs||6)*1000; }, 0);
  var starts = []; (function(){ var a = 0; slides.forEach(function(s){ starts.push(a); a += (+s.dataset.secs||6)*1000; }); })();
  function show(n){
    i = (n + slides.length) % slides.length;
    slides.forEach(function(s, k){ s.classList.toggle('on', k === i); });
    var img = slides[i].querySelector('img');
    if (img){ img.style.animation = 'none'; void img.offsetWidth; img.style.animation = ''; }
    t0 = performance.now(); held = 0;
  }
  function tick(now){
    raf = requestAnimationFrame(tick);
    // While paused, keep sliding t0 forward so the slide resumes where it
    // stopped instead of jumping.
    if (paused){ t0 = now - held; return; }
    held = now - t0;
    var dur = (+slides[i].dataset.secs || 6) * 1000;
    bar.style.width = ((starts[i] + Math.min(held, dur)) / total * 100) + '%';
    if (held >= dur) show(i + 1);
  }
  document.addEventListener('click', function(){ paused = !paused; });
  document.addEventListener('keydown', function(e){
    if (e.key === ' '){ e.preventDefault(); paused = !paused; }
    if (e.key === 'ArrowRight') show(i + 1);
    if (e.key === 'ArrowLeft') show(i - 1);
  });
  show(0);
  raf = requestAnimationFrame(tick);
})();
</script>
</body>
</html>`;

await writeFile(OUT, html, 'utf8');
const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log('wrote ' + OUT + '  ' + built.length + ' slides, ' + total + 's, ' + kb + ' KB');
if (missing.length) {
  console.log('\nstill to come (rendered as labelled placeholders):');
  missing.forEach(m => console.log('  · ' + m));
}
