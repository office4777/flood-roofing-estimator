// Builds the Australian site (roofmap.com) from the New Zealand pages.
//
//   node floodroofing/tools/build-au-site.mjs
//
// roofmap.co.nz and roofmap.com are the SAME Vercel project. vercel.json sends
// the roofmap.com host's core pages to frontend/au/<page>.html; every other
// path (the app, the legal pages, the guides) is shared. The NZ pages are the
// source of truth: each Australian page is its NZ twin with the explicit,
// reviewed replacements below applied, so a fix made on the NZ page reaches
// Australia the next time this runs — and tests/ausite.mjs rebuilds every page
// in memory and fails the gate if frontend/au/ has drifted from what this
// produces. NEVER hand-edit frontend/au/: change the NZ page or a rule here.
//
// A rule that no longer matches its NZ text THROWS (unless marked optional):
// the NZ wording moved, and the Australian wording has to be decided again
// rather than silently left in New Zealand English.
//
// It also keeps the en-NZ / en-AU hreflang pair on each NZ page that has an
// Australian twin (the one change it makes to the NZ pages), and writes the
// Australian sitemap and robots.txt. The sitemap's dates mirror the NZ
// sitemap's, so run this after tools/sitemap-dates.mjs (which calls it).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FRONT = join(HERE, '..', 'frontend');
export const AU_DIR = join(FRONT, 'au');
export const NZ_SITE = 'https://roofmap.co.nz';
export const AU_SITE = 'https://roofmap.com';

// Clean URL → the NZ source file (also the au/ file's name). `index:false` is
// the sign-up form: noindex, no canonical, not in the sitemap.
export const AU_PAGES = {
  '/':                               { file: 'landing.html' },
  '/pricing':                        { file: 'pricing.html' },
  '/signup':                         { file: 'signup.html', index: false },
  '/features/roof-measuring':        { file: 'features-measuring.html' },
  '/features/quotes':                { file: 'features-quotes.html' },
  '/features/job-pack':              { file: 'features-job-pack.html' },
  '/roofmap-and-fergus':             { file: 'fergus.html' },
  '/about':                          { file: 'about.html' },
  '/early-access':                   { file: 'early-access.html' },
  '/tools/roof-pitch-calculator':    { file: 'tools-roof-pitch-calculator.html' },
  '/tools/roofing-sheet-calculator': { file: 'tools-roofing-sheet-calculator.html' },
};
export const AU_SITEMAP_PATH = '/sitemap-au.xml';   // served by a roofmap.com rewrite

// ── matching helpers ────────────────────────────────────────────────
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A phrase that may wrap across lines in the source: any run of whitespace in
// it matches any run of whitespace (including a newline and indentation).
const L = phrase => new RegExp(esc(phrase).replace(/\s+/g, '\\s+'), 'g');
// rule: [find, replace, opts] — find is a string (exact, every occurrence) or a
// RegExp (must be /g). opts.optional: no match is not an error.
const r = (find, replace, opts) => ({ find, replace, ...(opts || {}) });

// ── shared Australian copy ──────────────────────────────────────────
// Applied to every page AFTER its own rules, so a page rule can say something
// more specific first. All optional: they apply wherever their text appears.
const TM_NOTE = 'COLORBOND®, ZINCALUME®, LYSAGHT®, CUSTOM ORB®, TRIMDEK®, KLIP-LOK® and SPANDEK® are registered trade marks of BlueScope Steel Limited.';
const AUD_NOTE = 'Prices in AUD, billed from New Zealand. No GST for ABN-registered businesses.';
const SHARED = [
  r('<html lang="en-NZ">', '<html lang="en-AU">'),
  r(/"inLanguage":\s*"en-NZ"/g, '"inLanguage": "en-AU"'),
  r('<meta property="og:locale" content="en_NZ">', '<meta property="og:locale" content="en_AU">'),
  r(/"priceCurrency":\s*"NZD"/g, '"priceCurrency": "AUD"'),
  // areaServed / eligibleRegion (the founder's own postal address keeps NZ)
  r(/("@type":\s*"Country",\s*"name":\s*)"New Zealand"/g, '$1"Australia"'),
  // The guides and the case study stay New Zealand-only for now: no link to
  // them from the Australian pages (nav, footer, breadcrumbs).
  r(/\n[ \t]*<a href="\/guides">Guides<\/a>/g, ''),
  r('<a href="/guides">Guides</a><span>›</span>', ''),
  r('Built by a roofer, in Northland', 'Built by a roofer, in New Zealand'),
  r('roofer — Northland.', 'roofer — Northland, New Zealand.'),
  r('New Zealand roofers', 'Australian roofers'),
  r('NZ roofers', 'Australian roofers'),
  r('placeholder="Acme Roofing Ltd"', 'placeholder="Acme Roofing Pty Ltd"'),
  r('placeholder="sam@acmeroofing.co.nz"', 'placeholder="sam@acmeroofing.com.au"'),
  r('placeholder="you@yourroofing.co.nz"', 'placeholder="you@yourroofing.com.au"'),
  r('placeholder="021 000 0000"', 'placeholder="0400 000 000"'),
  r('placeholder="021 555 0100"', 'placeholder="0400 000 000"'),
  // Every absolute link becomes roofmap.com. Last, so page rules above can
  // still name the NZ URL when they need to.
  r(/https:\/\/(?:www\.)?roofmap\.co\.nz/g, AU_SITE),
].map(x => ({ ...x, optional: true }));

// The tier "per" lines and the three-price sentences, used on several pages.
const TIER_PER = [
  r('<div class="amt">$79</div>', '<div class="amt">A$79</div>'),
  r('<div class="amt">$149</div>', '<div class="amt">A$149</div>'),
  r('<div class="amt">$299</div>', '<div class="amt">A$299</div>'),
];
// A JSON-LD BreadcrumbList item for /guides, dropped, and the item after it
// renumbered (the two tools pages).
const DROP_GUIDES_CRUMB = [
  r(/\{\s*"@type":\s*"ListItem",\s*"position":\s*2,\s*"name":\s*"Guides",\s*"item":\s*"https:\/\/roofmap\.co\.nz\/guides"\s*\},\s*/g, ''),
  r(/"position":\s*3,/g, '"position": 2,'),
];

// ── per-page rules ──────────────────────────────────────────────────
export const PAGE_RULES = {
  'landing.html': [
    r('Built by a working NZ roofing company.', 'Built by a working roofing company.'),
    r('alt="A re-roof in progress on a New Zealand home"', 'alt="A metal re-roof in progress"'),
    r(L('Or read <a href="/case-studies/re-roof-quoted-in-ten-minutes" style="font-weight:700">what it changed on one of our own jobs</a>.'), ''),
    r(/(Watch the full six-minute walkthrough<\/a> — Fergus, the job pack, the order email and the customer's side of the quote\.)\s+(<\/p>)/g, '$1$2'),
    r('New Zealand roofing businesses quoting long-run steel', 'Australian roofing businesses quoting metal roofing'),
    r(L('RoofMap came out of <strong>a working roofing company</strong> in Northland.'),
      'RoofMap came out of <strong>a working roofing company</strong> in Northland, New Zealand.'),
    r('<li>Priced and ordered on live New Zealand re-roofs, not demo data</li>', '<li>Priced and ordered on live re-roofs, not demo data</li>'),
    r('<li>Colorsteel®, Zincalume®, ColorCote® and Marley products already costed in</li>',
      '<li>Your own steel, profiles and gutters set up once — COLORBOND®, ZINCALUME®, CUSTOM ORB®, TRIMDEK®, Quad gutter or whatever you sell</li>'),
    r('<li>NZ pitches, NZ profiles, NZ suppliers, GST built in</li>',
      '<li>Your supplier\'s prices and your labour rates, with GST on your customer quotes at the rate you set</li>'),
    r(/(<\/ul>\s*<\/div>\s*<div><img src="brand\/team_lineup_2026\.jpg")/g,
      '</ul>\n      <p style="margin-top:12px;font-size:12.5px;color:var(--muted)">' + TM_NOTE + '</p>\n    </div>\n    <div><img src="brand/team_lineup_2026.jpg"'),
    r(L('The overseas products charge roughly <strong>$40&ndash;$65 a roof</strong> to measure it for you &mdash; twenty roofs a month and you are past <strong>$1,000</strong> before you have priced anything.'),
      'Per-report measuring services charge roughly <strong>A$35&ndash;$60 a roof</strong> to measure it\n         for you &mdash; twenty roofs a month is <strong>A$700 to $1,200</strong> before you have priced anything.'),
    ...TIER_PER,
    r('<div class="per">per month + GST · 1 user</div>', '<div class="per">AUD per month · 1 user</div>'),
    r('<div class="per">per month + GST · up to 5 users</div>', '<div class="per">AUD per month · up to 5 users</div>'),
    r('<li><span>Your own address — <em>yourname</em>.roofmap.co.nz</span></li>', '<li>Your own web address for customer quote links</li>'),
    r(L('Prices in NZD, excluding GST.'), AUD_NOTE),
    r('roofmap.co.nz/?preview', 'roofmap.com/?preview'),
  ],

  'pricing.html': [
    r('NZ$79, $149 or $299 a month plus GST, priced per business rather than per seat.', 'A$79, $149 or $299 a month, priced per business rather than per seat.'),
    r('for New Zealand roofing businesses.', 'for Australian roofing businesses.'),
    r('Overseas measuring services charge roughly NZ$40 to $65 a roof, which is past $1,000 a month at twenty roofs.',
      'Per-report measuring services charge roughly A$35 to $60 a roof, which is A$700 to $1,200 a month at twenty roofs.'),
    r('"name": "Are prices in New Zealand dollars?"', '"name": "Are prices in Australian dollars?"'),
    r('"text": "Yes. All prices are NZD and exclude GST. RoofMap is built for New Zealand roofing only — NZ profiles, NZ steel grades, NZ coastal corrosion zones and 15% GST throughout."',
      '"text": "Yes. All prices are in Australian dollars, billed from New Zealand — Australian businesses with an ABN pay no GST on top. Your own customer quotes carry GST at the rate you set. The built-in product list and trade rates started in New Zealand, so load your own steel, profiles and supplier prices before your first quote."'),
    r(L('All prices are NZD per month and exclude GST.'), 'All prices are AUD per month, with no GST for ABN-registered businesses.'),
    r('<strong>RoofMap is NZ$79, $149 or $299 a month plus GST</strong>', '<strong>RoofMap is A$79, $149 or $299 a month</strong>'),
    ...TIER_PER,
    r('<div class="per">per month + GST</div>', '<div class="per">AUD per month</div>'),
    r(L('Measure $790, Trade $1,490, Team $2,990 a year + GST.'), 'Measure A$790, Trade A$1,490, Team A$2,990 a year.'),
    r('<p class="tier-note">Month to month. No contract and no lock-in — cancel any time and stop paying.</p>',
      '<p class="tier-note">Month to month. No contract and no lock-in — cancel any time and stop paying.</p>\n    <p class="tier-note">' + AUD_NOTE + '</p>'),
    r(L('roughly <strong>NZ$40 to $65 each</strong>'), 'roughly <strong>A$35 to $60 each</strong>'),
    r('<p>Overseas roof-measuring services sell you a report per roof', '<p>Roof-measuring services sell you a report per roof'),
    r('<strong>$800 to $1,300</strong>', '<strong>A$700 to $1,200</strong>'),
    r('<td><strong>$800 – $1,300+</strong></td>', '<td><strong>A$700 – $1,200+</strong></td>'),
    r('<td>$800 – $1,300</td>', '<td>A$700 – $1,200</td>'),
    r('<td><strong>$299 + GST</strong></td>', '<td><strong>A$299</strong></td>'),
    r(L('Comparison figures are the advertised per-report range for aerial measuring services available in New Zealand at the time of writing, converted to NZD. Check current pricing with the provider — it moves.'),
      'Comparison figures are the advertised per-report range for aerial measuring services in\n        New Zealand at the time of writing, converted to Australian dollars; providers in Australia\n        vary. Check current pricing with the provider — it moves.'),
    r(L('RoofMap is built by a working roofer in Northland, and that'), 'RoofMap is built by a working roofer in Northland, New Zealand, and that'),
    r('<summary>Are the prices in New Zealand dollars?</summary>', '<summary>Are the prices in Australian dollars?</summary>'),
    r(L('Yes, and they exclude GST. RoofMap is built for New Zealand roofing only — NZ profiles, NZ steel grades, NZ coastal corrosion zones and 15% GST throughout.'),
      'Yes. They are billed from New Zealand, and Australian businesses with an ABN pay no\n          GST on top. Your own customer quotes carry GST at the rate you set.'),
    r(L('They are real New Zealand trade rates, and they are a starting point, not your prices. Check them against your merchant before you send a quote'),
      'They are New Zealand trade rates — there so the sample job reads as a believable number, not\n          your prices. Load your own supplier\'s prices before you send a quote'),
  ],

  'signup.html': [
    // The other half of the country choice: the Australian copy of the form
    // starts on Australia (signup.html's own script reads this attribute).
    r('data-default-country="NZ"', 'data-default-country="AU"', { optional: true, warn: 'signup.html has no data-default-country="NZ" yet' }),
  ],

  'features-measuring.html': [
    r('<a class="next-card" href="/guides/how-to-quote-a-re-roof"><b>How to quote a re-roof</b><span>The whole method, by hand or in software — measurements, material, labour, margin.</span></a>',
      '<a class="next-card" href="/tools/roofing-sheet-calculator"><b>Roofing sheet calculator</b><span>Face size and pitch in, sheet length and count out — with the working.</span></a>'),
  ],

  'features-quotes.html': [
    r('<li><strong>Profile</strong> — corrugate or 5-rib</li>',
      '<li><strong>Profile</strong> — the profiles you sell, such as CUSTOM ORB®, TRIMDEK®, KLIP-LOK® or SPANDEK®</li>'),
    r('<li><strong>Steel grade</strong> — Colorsteel MAXAM, Armorsteel ColorZen, ColorCote, or plain Zincalume</li>',
      '<li><strong>Steel grade</strong> — COLORBOND® steel, COLORBOND® Ultra for the coast, or plain ZINCALUME®</li>'),
    r('<li><strong>Gauge</strong> — 0.40 or 0.55</li>', '<li><strong>Gauge</strong> — the standard sheet or a heavier one</li>'),
    r('<li><strong>Guttering</strong> — Colorsteel box, Marley Typhoon, Marley Classic, or none</li>',
      '<li><strong>Guttering</strong> — Quad, Hi-Quad, half-round, a box gutter, or none</li>'),
    r('<li><strong>Colour</strong> — the full standard palette, as swatches</li>', '<li><strong>Colour</strong> — your colour range, as swatches</li>'),
    r(L('order — you do not re-enter it anywhere.</p>'),
      'order — you do not re-enter it anywhere.</p>\n      <p>The product list is yours: set up your grades, profiles and gutters once in Settings and\n        every quote offers them.</p>\n      <p style="font-size:13px;color:var(--muted)">' + TM_NOTE + '</p>'),
    r('your contact details, your GST number.', 'your contact details, your ABN.'),
    r('contact details and GST number, from Settings', 'contact details and ABN, from Settings'),
  ],

  'features-job-pack.html': [
    r('<li><strong>Underlay</strong>, screws and rivets', '<li><strong>Sarking / underlay</strong>, screws and rivets'),
    r(L('which is the gap that used to send an order out as corrugate and 0.40 for a customer who had paid for 5-rib and 0.55.'),
      'which is the gap that used to send an order out as Custom Orb® in the standard gauge for a\n        customer who had paid for Trimdek® in a heavier one.'),
    r('<span>$79, $149 or $299 a month plus GST, per business rather than per seat.</span>', '<span>A$79, $149 or $299 a month, per business rather than per seat.</span>'),
  ],

  'fergus.html': [],

  'about.html': [
    r(/"Colorsteel",/g, '"Steel roof cladding",'),
    r(/"Long-run steel roofing",/g, '"Metal roofing",'),
    r('"A long-run steel roofing contractor in Northland,', '"A metal roofing contractor in Northland, New Zealand,'),
    r('"text": "Only if you work in Northland, and there is more roof up here than one company can put on.',
      '"text": "No. The founder\'s roofing company works in Northland, New Zealand — not in Australia.'),
    r('"name": "Why is it New Zealand only?"', '"name": "Does RoofMap work for Australian roofers?"'),
    r('"text": "Because the parts that matter are local. Coastal corrosion zones, Colorsteel warranty tiers, the profiles the mills actually roll here, the merchants, 15% GST. Software written for another market gets all of that wrong in ways that are hard to see until an order is short."',
      '"text": "Yes. The measuring, the pitch arithmetic, the cut lists and the customer quote work the same on any metal roof. What is local is the product list and the prices: set up your own steel grades, profiles, gutters and supplier rates once, and every quote after that uses them. Prices are in Australian dollars."'),
    r(L('RoofMap came out of a working roofing company in Northland. It'), 'RoofMap came out of a working roofing company in Northland, New Zealand. It'),
    r(/<h2>What that means for you<\/h2>\s*<ul>[\s\S]*?<\/ul>/g,
      '<h2>What that means for you</h2>\n      <ul>\n' +
      '        <li>Your own steel grades, profiles and gutters, set up once — COLORBOND®, ZINCALUME®, CUSTOM ORB®,\n          TRIMDEK® or whatever you sell</li>\n' +
      '        <li>Your supplier\'s prices and your labour rates, with GST on your customer quotes at the rate you set</li>\n' +
      '        <li>Sheet runs, flashings and the cut list worked out at the true pitch, off one drawing</li>\n' +
      '        <li>Rates that ship as New Zealand trade rates, so the sample job reads as a believable number —\n          load your own before your first quote</li>\n' +
      '      </ul>\n      <p style="font-size:13px;color:var(--muted)">' + TM_NOTE + '</p>'),
    r('owns and runs a long-run steel roofing company in Northland:', 'owns and runs a metal roofing company in Northland, New Zealand:'),
    r(L('<div class="a"><p>Only if you work in Northland, and there is more roof up here than one company can put on.'),
      '<div class="a"><p>No. The founder\'s roofing company works in Northland, New Zealand — not in Australia.'),
    r('<summary>Why is it New Zealand only?</summary>', '<summary>Does RoofMap work for Australian roofers?</summary>'),
    r(L('<div class="a"><p>Because the parts that matter are local. Coastal corrosion zones, Colorsteel warranty tiers, the profiles the mills actually roll here, the merchants, 15% GST. Software written for another market gets all of that wrong in ways that are hard to see until an order is short.</p></div>'),
      '<div class="a"><p>Yes. The measuring, the pitch arithmetic, the cut lists and the customer quote work the same on any metal roof. What is local is the product list and the prices: set up your own steel grades, profiles, gutters and supplier rates once, and every quote after that uses them. Prices are in Australian dollars.</p></div>'),
    r(L('<p class="founder-note">RoofMap Limited is its own company, separate from the roofing business Aron runs. <a href="/case-studies/re-roof-quoted-in-ten-minutes">What it changed on one of our own jobs →</a></p>'),
      '<p class="founder-note">RoofMap Limited is its own company, separate from the roofing business Aron runs.</p>'),
  ],

  'early-access.html': [
    r(L('About a minute at <a href="/signup" style="font-weight:600">roofmap.co.nz/signup</a>'),
      'About a minute at <a href="/signup" style="font-weight:600">roofmap.com/signup</a>'),
    r(L('RoofMap ships with real New Zealand trade rates so your first quote is a believable number rather than zero. They are a starting point, not your prices — send us a merchant price list and we will get your own rates in.'),
      'RoofMap ships with New Zealand trade rates so the sample job reads as a believable\n               number rather than zero. They are a placeholder, not your prices — send us your\n               merchant\'s price list and we will get your own rates in.'),
    r(L('it is $79, $149 or $299 a month plus GST, month to month.'), 'it is A$79, $149 or $299 a month, month to month.'),
    r(/<option value="">Select a region…<\/option>[\s\S]*?<\/select>/g,
      '<option value="">Select a state…</option>\n' +
      '            <option>New South Wales</option><option>Victoria</option><option>Queensland</option>\n' +
      '            <option>Western Australia</option><option>South Australia</option><option>Tasmania</option>\n' +
      '            <option>Australian Capital Territory</option><option>Northern Territory</option>\n' +
      '          </select>'),
  ],

  'tools-roof-pitch-calculator.html': [
    ...DROP_GUIDES_CRUMB,
    r(L(' The full explanation is in <a href="/guides/roof-pitch-explained">roof pitch explained</a>.'), ''),
    r('<a class="next-card" href="/guides/roof-pitch-explained"><b>Roof pitch explained</b><span>The long version — every length pitch changes, and the ones it does not.</span></a>',
      '<a class="next-card" href="/features/job-pack"><b>The whole cut list at once</b><span>Every face, every length, every flashing — off the roof you traced.</span></a>'),
  ],

  'tools-roofing-sheet-calculator.html': [
    ...DROP_GUIDES_CRUMB,
    r('<title>Roofing sheet calculator NZ — long-run steel lengths</title>', '<title>Roofing sheet calculator — metal roof sheet lengths</title>'),
    r('Roofing sheet calculator for long-run steel', 'Roofing sheet calculator for metal roofing'),
    r('Work out long-run steel sheet lengths,', 'Work out metal roof sheet lengths,'),
    r('"name": "Long-run steel roofing"', '"name": "Metal roofing"'),
    r(L('rounded up — <strong>762 mm</strong> on New Zealand corrugate, from a nominal 860 mm sheet.'),
      'rounded up — <strong>762 mm</strong> for a corrugated profile such as CUSTOM ORB®.'),
    r(L('at 25°, in corrugate. Here it'), 'at 25°, in a corrugated profile with 762 mm cover. Here it'),
    r(L('New Zealand corrugate is a nominal <strong>860 mm</strong> sheet with <strong>762 mm</strong> of cover. Put 860 in the box above'),
      'A corrugated\n        profile such as CUSTOM ORB® covers <strong>762 mm</strong>, and the sheet itself is wider. Put an\n        overall width — say <strong>860 mm</strong> — in the box above'),
    r(L('Trapezoidal profiles cover differently again.'), 'Trapezoidal and concealed-fix profiles — TRIMDEK®, SPANDEK®, KLIP-LOK® — cover differently again.'),
    r('What cover width should I use for corrugate?', 'What cover width should I use for Custom Orb?'),
    r('762 mm, from a nominal 860 mm sheet. The 98 mm difference is the side lap.', '762 mm — the width it covers once it side-laps into its neighbour, not the width of the sheet.'),
    r('Using 860 instead gives you', 'Using an 860 mm sheet width instead gives you'),
    r('Sheet wastage on long-run is small', 'Sheet wastage on metal roofing is small'),
    r(L('See <a href="/guides/roof-flashings-explained">roof flashings explained</a>.'), 'RoofMap\'s <a href="/features/job-pack">job pack</a> lists them piece by piece.'),
    r('purlin layout and wind zone on the day', 'purlin layout and wind classification on the day'),
    r(/\s*<p>The full method, including all of the above, is in\s*<a href="\/guides\/calculating-sheet-lengths">calculating sheet lengths and counts<\/a>\.<\/p>/g, ''),
    r('<a class="next-card" href="/guides/calculating-sheet-lengths"><b>The full method</b><span>Run length, cover width, laps and what the counts feed into next.</span></a>',
      '<a class="next-card" href="/features/roof-measuring"><b>Skip the arithmetic</b><span>Trace the roof over an aerial, enter the pitch once, and every length follows.</span></a>'),
  ],
};

// ── the build ───────────────────────────────────────────────────────
function applyRule(html, rule, where, warnings){
  let n = 0, out;
  if (typeof rule.find === 'string'){
    n = html.split(rule.find).length - 1;
    out = n ? html.split(rule.find).join(rule.replace) : html;
  } else {
    if (!rule.find.global) throw new Error('rule regex must be /g: ' + rule.find);
    n = (html.match(rule.find) || []).length;
    out = n ? html.replace(rule.find, rule.replace) : html;
  }
  if (!n && !rule.optional){
    throw new Error(where + ': rule no longer matches the NZ page — decide the Australian wording again: ' +
      String(rule.find).slice(0, 140));
  }
  if (!n && rule.warn && warnings) warnings.push(where + ': ' + rule.warn);
  return out;
}

const HREFLANG_RE = /<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n/g;
export function hreflangBlock(path){
  return '<link rel="alternate" hreflang="en-NZ" href="' + NZ_SITE + path + '">\n' +
         '<link rel="alternate" hreflang="en-AU" href="' + AU_SITE + path + '">\n';
}
function insertAfterCanonical(html, site, path, where){
  const canon = '<link rel="canonical" href="' + site + path + '">\n';
  const i = html.indexOf(canon);
  if (i < 0) throw new Error(where + ': no canonical link for ' + site + path);
  return html.slice(0, i + canon.length) + hreflangBlock(path) + html.slice(i + canon.length);
}

// The NZ page with its hreflang pair in place (idempotent).
export function nzWithHreflang(path, html){
  const page = AU_PAGES[path];
  html = html.replace(HREFLANG_RE, '');
  if (page.index === false) return html;
  return insertAfterCanonical(html, NZ_SITE, path, page.file);
}

export function buildPage(path, nzHtml, warnings){
  const page = AU_PAGES[path];
  if (!page) throw new Error('not an Australian page: ' + path);
  let html = nzHtml.replace(HREFLANG_RE, '');
  for (const rule of (PAGE_RULES[page.file] || [])) html = applyRule(html, rule, page.file, warnings);
  for (const rule of SHARED) html = applyRule(html, rule, page.file, warnings);
  if (page.index !== false) html = insertAfterCanonical(html, AU_SITE, path, page.file);
  // Say so at the top, where a hand-edit would start.
  html = html.replace(/^<!doctype html>\n/i, m => m +
    '<!-- GENERATED for roofmap.com by floodroofing/tools/build-au-site.mjs from ../' + page.file +
    ' — do not edit this file; change the New Zealand page or the rules and re-run. -->\n');
  return html;
}

// The Australian sitemap: every indexable AU page, each dated as its NZ twin
// is in frontend/sitemap.xml (the generator's input, so this stays a pure
// function of the files and the test can rebuild it exactly).
export function buildSitemap(nzSitemap){
  const nz = {};
  for (const m of nzSitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>\s*<changefreq>([^<]+)<\/changefreq>\s*<priority>([^<]+)<\/priority>/g))
    nz[m[1]] = { lastmod: m[2], changefreq: m[3], priority: m[4] };
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n<!--\n' +
    '  Every indexable page on roofmap.com (the Australian site). GENERATED by\n' +
    '  floodroofing/tools/build-au-site.mjs — do not edit. Each date is its New\n' +
    '  Zealand twin\'s, from ../sitemap.xml. roofmap.com serves it at\n' +
    '  ' + AU_SITE + AU_SITEMAP_PATH + ' (vercel.json). /signup is absent: it is noindex.\n-->\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const [path, page] of Object.entries(AU_PAGES)){
    if (page.index === false) continue;
    const src = nz[NZ_SITE + path];
    if (!src) throw new Error('sitemap.xml has no entry for ' + NZ_SITE + path);
    out += '\n  <url>\n    <loc>' + AU_SITE + path + '</loc>\n    <lastmod>' + src.lastmod + '</lastmod>\n' +
      '    <changefreq>' + src.changefreq + '</changefreq>\n    <priority>' + src.priority + '</priority>\n  </url>\n';
  }
  return out + '\n</urlset>\n';
}

export function buildRobots(nzRobots){
  let out = nzRobots;
  if (!/^# RoofMap — https:\/\/roofmap\.co\.nz$/m.test(out) || !/^Sitemap: https:\/\/roofmap\.co\.nz\/sitemap\.xml$/m.test(out))
    throw new Error('robots.txt: its header or Sitemap line moved — update buildRobots');
  out = out.replace(/^# RoofMap — https:\/\/roofmap\.co\.nz$/m,
    '# RoofMap (Australia) — ' + AU_SITE + '\n# GENERATED from ../robots.txt by floodroofing/tools/build-au-site.mjs — do not edit.');
  out = out.replace(/^Sitemap: https:\/\/roofmap\.co\.nz\/sitemap\.xml$/m, 'Sitemap: ' + AU_SITE + AU_SITEMAP_PATH);
  return out;
}

// Every file the Australian site is made of, plus the NZ pages as they should
// read with their hreflang pair. read(name) reads a file under frontend/.
export function buildAll(read){
  const warnings = [];
  const au = {}, nz = {};
  for (const [path, page] of Object.entries(AU_PAGES)){
    const src = read(page.file);
    nz[page.file] = nzWithHreflang(path, src);
    au[page.file] = buildPage(path, src, warnings);
  }
  au['sitemap.xml'] = buildSitemap(read('sitemap.xml'));
  au['robots.txt'] = buildRobots(read('robots.txt'));
  return { au, nz, warnings };
}

// ── what an Australian page must never say ───────────────────────────
// NZ-only products, NZ-only bodies and NZ pricing. Returns the problems found.
export const AU_FORBIDDEN = [
  [/colorsteel/i, 'Colorsteel'], [/colorcote/i, 'ColorCote'], [/maxam/i, 'MAXAM'], [/armorsteel/i, 'Armorsteel'],
  [/marley/i, 'Marley'], [/spouting/i, 'spouting'], [/\bkiwi/i, 'Kiwi'], [/\bLINZ\b/, 'LINZ'],
  [/\bRANZ\b/, 'RANZ'], [/\bLBP\b/, 'LBP'], [/site\s*safe/i, 'Site Safe'], [/sitewise/i, 'Sitewise'],
  [/\bcorrugate\b/i, 'corrugate (say Custom Orb / corrugated)'], [/5-rib/i, '5-Rib'], [/long-run/i, 'long-run'],
  [/building consent/i, 'building consent'], [/\bNZD\b/, 'NZD'], [/NZ\$/, 'NZ$'],
  [/(?<!['"])\bNZ\b(?!['"])/, 'NZ'],
  [/\+ GST|plus GST|exclud\w* GST/i, 'RoofMap prices + GST'],
  [/\/guides\b|\/case-studies\b/, 'a link to the NZ guides or case study'],
  [/href="https?:\/\/(?:www\.)?roofmap\.co\.nz/i, 'a link to roofmap.co.nz'],
];
export function auditAu(html){
  // The en-NZ alternate is the one roofmap.co.nz URL an AU page carries.
  const body = html.replace(HREFLANG_RE, '');
  const bad = [];
  for (const [re, name] of AU_FORBIDDEN) if (re.test(body)) bad.push(name);
  if (/https:\/\/(?:www\.)?roofmap\.co\.nz/.test(body)) bad.push('an absolute roofmap.co.nz URL');
  return bad;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]){
  const read = f => readFileSync(join(FRONT, f), 'utf8');
  const { au, nz, warnings } = buildAll(read);
  if (!existsSync(AU_DIR)) mkdirSync(AU_DIR, { recursive: true });
  let wrote = 0, nzWrote = 0, problems = 0;
  for (const [f, html] of Object.entries(au)){
    const p = join(AU_DIR, f);
    if (!existsSync(p) || readFileSync(p, 'utf8') !== html){ writeFileSync(p, html); wrote++; }
    if (/\.html$/.test(f)){
      const bad = auditAu(html);
      if (bad.length){ problems++; console.error('au/' + f + ' still says: ' + bad.join(', ')); }
    }
  }
  for (const [f, html] of Object.entries(nz)){
    if (read(f) !== html){ writeFileSync(join(FRONT, f), html); nzWrote++; }
  }
  warnings.forEach(w => console.warn('warning: ' + w));
  console.log('au: ' + wrote + ' file' + (wrote === 1 ? '' : 's') + ' written, ' + nzWrote + ' NZ page' + (nzWrote === 1 ? '' : 's') + ' given hreflang');
  if (problems) process.exit(1);
}
