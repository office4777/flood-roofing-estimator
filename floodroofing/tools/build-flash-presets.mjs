// Copies the app's shipped flashing presets (`_FLASH_BUILTIN_PRESETS` in
// frontend/app.html) to backend/flash-presets.json, so the crew app's
// "Order flashing" offers the same built-ins the office's library does.
// Run after changing a preset: node floodroofing/tools/build-flash-presets.mjs
// tests/crewapi.mjs fails when the two differ.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export function extractPresets(html){
  const at = html.indexOf('var _FLASH_BUILTIN_PRESETS = [');
  if (at < 0) throw new Error('_FLASH_BUILTIN_PRESETS not found in app.html');
  const start = html.indexOf('[', at);
  const end = html.indexOf('\n];', start);
  const list = (new Function('return ' + html.slice(start, end + 2)))();
  const keep = ['name', 'profile', 'flashingType', 'polylines', 'paintedSide', 'flashGuard', 'flashGuards', 'girthMm', 'angleChanges', 'crushFoldCount'];
  return list.map(e => { const o = {}; keep.forEach(k => { if (e[k] !== undefined) o[k] = e[k]; }); return o; });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const html = fs.readFileSync(path.join(here, '..', 'frontend', 'app.html'), 'utf8');
  const out = extractPresets(html);
  fs.writeFileSync(path.join(here, '..', 'backend', 'flash-presets.json'), JSON.stringify(out) + '\n');
  console.log('flash-presets.json:', out.length, 'presets');
}
