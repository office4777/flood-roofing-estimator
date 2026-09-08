// Stamps every <lastmod> in frontend/sitemap.xml with the date its page last
// changed in git. Run it before a ship; tests/seo.mjs fails when the two
// disagree, so a page edited by hand cannot keep last month's date.
//
//   node floodroofing/tools/sitemap-dates.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const FRONT = join(HERE, '..', 'frontend');
export const PAGES = {
  '/': 'landing.html', '/pricing': 'pricing.html', '/early-access': 'early-access.html',
  '/features/roof-measuring': 'features-measuring.html', '/features/job-pack': 'features-job-pack.html',
  '/features/quotes': 'features-quotes.html', '/roofmap-and-fergus': 'fergus.html', '/guides': 'guides.html',
  '/guides/how-to-quote-a-re-roof': 'guides-quote-a-re-roof.html',
  '/guides/roof-flashings-explained': 'guides-roof-flashings-explained.html',
  '/guides/calculating-sheet-lengths': 'guides-calculating-sheet-lengths.html',
  '/guides/roof-pitch-explained': 'guides-roof-pitch-explained.html',
  '/guides/colorsteel-grades-compared': 'guides-colorsteel-grades-compared.html',
  '/guides/coastal-zones-and-warranties': 'guides-coastal-zones-and-warranties.html',
  '/guides/flashing-wastage': 'guides-flashing-wastage.html',
  '/guides/pipe-flashings-and-back-trays': 'guides-pipe-flashings-and-back-trays.html',
  '/guides/re-roof-scope-of-work': 'guides-re-roof-scope-of-work.html',
  '/tools/roof-pitch-calculator': 'tools-roof-pitch-calculator.html',
  '/tools/roofing-sheet-calculator': 'tools-roofing-sheet-calculator.html',
  '/about': 'about.html', '/case-studies/re-roof-quoted-in-ten-minutes': 'case-study-re-roof-quoted-in-ten-minutes.html', '/terms': 'terms.html', '/privacy': 'privacy.html',
};
export function gitDate(file){
  try { return execSync('git log -1 --format=%cs -- ' + JSON.stringify(join(FRONT, file)), { cwd: FRONT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; }
  catch (e) { return null; }
}
export function stamp(xml){
  let changed = 0;
  const out = xml.replace(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g, (m, loc, old) => {
    const path = loc.replace(/^https:\/\/roofmap\.co\.nz/, '') || '/';
    const file = PAGES[path]; if (!file) return m;
    const d = gitDate(file); if (!d || d === old) return m;
    changed++;
    return '<url>\n    <loc>' + loc + '</loc>\n    <lastmod>' + d + '</lastmod>';
  });
  return { out, changed };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]){
  const p = join(FRONT, 'sitemap.xml');
  const { out, changed } = stamp(readFileSync(p, 'utf8'));
  writeFileSync(p, out);
  console.log('sitemap: ' + changed + ' date' + (changed === 1 ? '' : 's') + ' updated');
}
