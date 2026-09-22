// Syntax-check every inline <script> in a single-file app.
//
//   node floodroofing/tools/check-app-syntax.mjs
//   node floodroofing/tools/check-app-syntax.mjs floodroofing/hub/FloodRoofing_Financials.html
//
// app.html is ~69k lines of CSS, markup and JS in one file. A stray quote or a
// bracket closed one line early is invisible in a diff that size and is found,
// otherwise, by a customer. Feeding each inline block to new Function() parses
// it without running it, which is the cheapest possible gate and catches the
// one class of mistake a scripted edit actually makes.
//
// Exits non-zero on the first bad block, naming the file line the block starts
// on so the editor can jump straight there.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = process.argv[2] || 'floodroofing/frontend/app.html';
const path = resolve(process.cwd(), target);
let html;
try {
  html = readFileSync(path, { encoding: 'utf8' });
} catch (e) {
  console.error('Cannot read ' + target + ': ' + e.message);
  process.exit(2);
}

// Only inline blocks: a <script src="..."> has no body to parse here, and a
// type that is not JavaScript (a JSON-LD block, say) is not ours to check.
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, blocks = 0, bad = 0;
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  const body = m[2] || '';
  if (/\bsrc\s*=/i.test(attrs)) continue;
  const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1];
  if (type && !/^(text|application)\/(java|ecma)script$|^module$/i.test(type)) continue;
  if (!body.trim()) continue;
  blocks++;
  const line = html.slice(0, m.index).split('\n').length;
  try {
    // eslint-disable-next-line no-new-func
    new Function(body);
  } catch (err) {
    bad++;
    console.error('FAIL  ' + target + ':' + line + '  ' + err.message);
  }
}

console.log('blocks ' + blocks + ' bad ' + bad);
process.exit(bad ? 1 : 0);
