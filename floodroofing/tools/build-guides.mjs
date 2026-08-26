// Renders the guide and calculator pages from tools/content-guides.mjs.
//
// Why a generator at all, on a site of hand-written HTML: every one of these
// pages carries the same twenty-odd head tags, the same three JSON-LD nodes,
// the same header and footer, and the canonical URL appears in six of them.
// Hand-copying that across a dozen pages is exactly how one ends up with a
// canonical pointing at the page it was copied from — which is the single
// worst head-tag mistake you can make, and the one seo.mjs exists to catch.
//
// The OUTPUT is committed. Vercel serves static files as before; this script
// is not a build step, it is a way of writing them. Run it, look at the diff,
// commit the diff.
//
//   node floodroofing/tools/build-guides.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import PAGES from './content-guides.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const SITE = 'https://roofmap.co.nz';
const IMG = SITE + '/brand/og-card.png';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// JSON-LD is inside a <script>, so the one sequence that must never appear
// raw is a closing script tag.
const ld = o => JSON.stringify(o, null, 2).replace(/<\//g, '<\\/');

// The FAQ appears twice — once as markup for the answer engines, once as
// <details> for a person. Writing it once and rendering both is the only way
// they stay in step; a FAQPage whose text disagrees with the visible page is
// a structured-data violation, not a typo.
const faqLd = faq => ({
  '@type': 'FAQPage',
  mainEntity: faq.map(f => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a.join('\n\n') },
  })),
});
const faqHtml = faq => faq.map((f, i) => `      <details${i === 0 ? ' open' : ''}>
        <summary>${esc(f.q)}</summary>
        <div class="a">${f.a.map(p => '<p>' + p + '</p>').join('')}</div>
      </details>`).join('\n');

const crumbsLd = p => ({
  '@type': 'BreadcrumbList',
  itemListElement: p.crumbs.map((c, i) => ({
    '@type': 'ListItem', position: i + 1, name: c.name, item: SITE + c.url,
  })),
});
const crumbsHtml = p => p.crumbs.map((c, i) =>
  i === p.crumbs.length - 1 ? esc(c.name) : `<a href="${c.url}">${esc(c.name)}</a>`
).join('<span>›</span>');

const HEADER = `<header class="solid">
  <div class="wrap nav">
    <a class="brand" href="/"><img src="/brand/roofmap_icon.png" alt=""><span>RoofMap</span></a>
    <nav class="nav-links">
      <a href="/features/roof-measuring">What it does</a>
      <a href="/pricing">Pricing</a>
      <a href="/guides">Guides</a>
      <a href="/index.html">Sign in</a>
      <a href="/early-access" class="nav-cta">Early access</a>
    </nav>
  </div>
</header>`;

const FOOTER = `<footer>
  <div class="wrap foot">
    <a href="/">RoofMap</a>
    <a href="/pricing">Pricing</a>
    <a href="/guides">Guides</a>
    <a href="/about">About</a>
    <a href="/terms">Terms</a>
    <a href="/privacy">Privacy</a>
    <span class="sp">Built by Flood Roofing, Northland</span>
  </div>
</footer>`;

// One CTA, one place. The 30% is stated with its 12-month term and what
// follows it every single time, because seo.mjs will not let it be stated
// any other way — and because that is the honest way to state it.
const CTA = `    <div class="cta-strip">
      <h2>We are letting roofers in a batch at a time.</h2>
      <p>Tell us about your setup and we will get you in, set up properly, with <strong>30% off your
        first 12 months</strong> and the standard rate after that.</p>
      <a class="btn btn-primary" href="/early-access">Request early access</a>
    </div>`;

const BYLINE = reviewed => `      <div class="byline">
        <img src="/brand/roofmap_icon.png" alt="" style="border-radius:9px;object-fit:contain;background:#f4f7fa;padding:5px">
        <div>
          <b>Flood Roofing Limited</b>
          Roofing contractors, Northland · Last reviewed ${reviewed}
        </div>
      </div>`;

function render(p){
  const url = SITE + p.url;
  const graph = [];

  if (p.kind === 'index'){
    graph.push({
      '@type': 'CollectionPage',
      '@id': url + '#page',
      name: p.h1,
      description: p.ldDescription || p.description,
      inLanguage: 'en-NZ',
      url,
      isPartOf: { '@id': SITE + '/#website' },
      publisher: { '@id': SITE + '/#organization' },
      mainEntity: {
        '@type': 'ItemList',
        itemListOrder: 'https://schema.org/ItemListUnordered',
        numberOfItems: p.items.length,
        itemListElement: p.items.map((it, i) => ({
          '@type': 'ListItem', position: i + 1, name: it.title, url: SITE + it.url,
        })),
      },
    });
  } else {
    graph.push({
      '@type': p.kind === 'tool' ? ['Article', 'WebApplication'] : 'Article',
      '@id': url + '#article',
      headline: p.h1,
      description: p.ldDescription || p.description,
      inLanguage: 'en-NZ',
      datePublished: p.published,
      dateModified: p.modified,
      author: { '@type': 'Organization', name: 'Flood Roofing Limited', url: 'https://floodroofing.co.nz' },
      publisher: { '@id': SITE + '/#organization' },
      image: IMG,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      about: (p.about || []).map(name => ({ '@type': 'Thing', name })),
      ...(p.kind === 'tool' ? {
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Runs in any modern browser',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'NZD' },
      } : {}),
    });
  }
  graph.push(crumbsLd(p));
  if (p.faq && p.faq.length) graph.push({ ...faqLd(p.faq), '@id': url + '#faq' });

  const head = [
    '<!doctype html>',
    '<html lang="en-NZ">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}">`,
    `<link rel="canonical" href="${url}">`,
    '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">',
    '<meta name="theme-color" content="#0a1628">',
    '<link rel="icon" href="/brand/roofmap_icon.png">',
    '<link rel="apple-touch-icon" href="/brand/pwa-192.png">',
    `<meta property="og:type" content="${p.kind === 'index' ? 'website' : 'article'}">`,
    '<meta property="og:site_name" content="RoofMap">',
    '<meta property="og:locale" content="en_NZ">',
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.description)}">`,
    `<meta property="og:image" content="${IMG}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="RoofMap — quote a re-roof before you leave the driveway">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(p.title)}">`,
    `<meta name="twitter:description" content="${esc(p.description)}">`,
    `<meta name="twitter:image" content="${IMG}">`,
    '<link rel="stylesheet" href="/site.css">',
    '<script type="application/ld+json">',
    ld({ '@context': 'https://schema.org', '@graph': graph }),
    '</script>',
    '</head>',
  ].join('\n');

  const masthead = `<section class="masthead">
  <div class="wrap">
    <div class="crumbs">${crumbsHtml(p)}</div>
    <div class="eyebrow">${esc(p.eyebrow)}</div>
    <h1>${esc(p.h1)}</h1>
    <p class="stand">${p.stand}</p>
    <p class="answer">${p.answer}</p>
  </div>
</section>`;

  const nextCards = (p.next || []).map(n =>
    `      <a class="next-card" href="${n.href}"><b>${esc(n.title)}</b><span>${esc(n.blurb)}</span></a>`
  ).join('\n');

  const parts = [head, '<body>', '', HEADER, '', '<main>', masthead, ''];

  parts.push(`<section style="padding-top:8px">
  <div class="wrap">
    <div class="prose${p.kind === 'index' ? ' prose-wide' : ''}">
${p.body}
${p.reviewed ? '\n' + BYLINE(p.reviewed) : ''}
    </div>
  </div>
</section>`);

  if (p.faq && p.faq.length){
    parts.push(`
<section class="tint">
  <div class="wrap">
    <div class="sec-head" style="max-width:640px">
      <div class="eyebrow">Questions</div>
      <h2>${esc(p.faqHeading || 'What comes up most.')}</h2>
    </div>
    <div class="faq" style="max-width:78ch">
${faqHtml(p.faq)}
    </div>
  </div>
</section>`);
  }

  parts.push(`
<section>
  <div class="wrap">
${nextCards ? `    <div class="sec-head" style="max-width:640px"><h2>Next</h2></div>
    <div class="next-grid">
${nextCards}
    </div>
` : ''}${CTA}
  </div>
</section>
</main>

${FOOTER}
${p.script ? '\n<script>\n' + p.script + '\n</script>\n' : ''}
</body>
</html>
`);

  return parts.join('\n');
}

let n = 0;
for (const p of PAGES){
  await writeFile(join(OUT, p.file), render(p));
  console.log('  ' + p.file.padEnd(38) + p.url);
  n++;
}
console.log('\n' + n + ' pages written');
