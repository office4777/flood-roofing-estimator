// AI Tendering — the sheet index: what each page IS, read off its title
// block, and the set as a whole (latest revision of each sheet, superseded
// copies, sheets the drawing register promises that are not in the files).
//
// Pure functions over the text pdf.js extracted; no I/O. The AI classifier
// (ai.js) runs AFTER this and may overrule a field — but every field it
// overrules is kept beside it, with where it came from, so a wrong call can
// be traced to the page it was read off.
'use strict';

// The classes a page can carry. The list is the contract the rest of the
// pipeline reads (P2 looks at roof_plan / roof_framing / detail_roof / spec),
// so a new class is added here and nowhere else.
const CLASSES = [
  'cover', 'index', 'site_plan', 'floor_plan', 'roof_plan', 'roof_framing', 'elevation', 'section',
  'detail_roof', 'detail_other', 'spec', 'schedule', 'structural', 'services', 'other',
];
// Which classes the roofing take-off reads. Everything else is kept and
// listed but never shown to the extractor.
const ROOF_RELEVANT = ['roof_plan', 'roof_framing', 'detail_roof', 'spec', 'elevation', 'section', 'cover', 'index', 'schedule'];

// A sheet number: AO-05, AN-12, A-101, A1.01, A101, S-02, RF-01, A3-4, 'DWG A05'.
// Two letters-ish prefix, optional separator, digits (with an optional dotted
// or dashed sub-number). Deliberately NOT a bare number — a scale, a date and
// a dimension are all bare numbers.
const SHEET_ID_RE = /\b([A-Z]{1,3}[0-9]?)\s?[-–.]?\s?([0-9]{1,3}(?:[.\-][0-9]{1,3})?)\b/g;
const REV_RE = /\b(?:REV(?:ISION)?|ISSUE)\b\.?\s*[:#]?\s*([A-Z]{1,2}|[0-9]{1,2})\b/i;
const SCALE_RE = /\b(1\s?:\s?[0-9]{1,4}(?:\s?,\s?1\s?:\s?[0-9]{1,4})*)\s*(?:@\s?A[0-4])?|\bNTS\b|\bNOT TO SCALE\b/i;
const DATE_RE = /\b([0-3]?[0-9][\/.\-][01]?[0-9][\/.\-](?:20)?[0-9]{2})\b|\b((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+20[0-9]{2})\b/i;

const TITLE_WORDS = /\b(PLAN|PLANS|ELEVATION|ELEVATIONS|SECTION|SECTIONS|DETAIL|DETAILS|SCHEDULES|SCHEDULE|SPECIFICATION|NOTES|LAYOUT|FRAMING|ROOF|FLOOR|SITE|COVER|INDEX|REGISTER|LIST|DRAINAGE|ELECTRICAL|BRACING|FOUNDATION|FLASHING|GUTTER|SPOUTING|PARAPET|EAVE|EAVES|RIDGE|VALLEY|APRON|PENETRATION|SKYLIGHT|FASCIA|SOFFIT|CLADDING|WALL|CEILING|STRUCTURAL|STEEL|TIMBER|PURLIN|RAFTER|TRUSS|OVERVIEW|LOCATION|PERSPECTIVE|3D|SETOUT|SET OUT|DEMOLITION|EXISTING|PROPOSED)\b/i;

function _norm(s){ return String(s || '').replace(/\s+/g, ' ').trim(); }
function _up(s){ return _norm(s).toUpperCase(); }

// Sheet ids that look like something else: a scale ("A1"), a paper size, a
// year, a grid reference ("A3" on a floor plan). A real sheet id either has a
// separator or at least two digits, or sits beside the words that name it.
function _plausibleSheetId(id, ctx){
  const u = _up(id);
  if (/^(A|B)[0-4]$/.test(u)) return false;                    // paper size
  if (/^[A-Z]{1,2}20[0-9]{2}$/.test(u)) return false;          // "C2026"
  if (/^[A-Z]{1,3}[0-9]{1,2}$/.test(u) && !/-|\./.test(id) && !/SHEET|DWG|DRAWING|NO\.?\b/i.test(ctx || '')) return false;
  return true;
}

// Read the title block off a page's words. The block is scored by where it
// sits (bottom-right of the sheet, or the right edge), and the id, title,
// revision, scale and date are each taken from the best-placed candidate.
// Returns {sheetId, title, revision, scale, date, confidence, from:{...}}.
function parseTitleBlock(page){
  const W = page.width || 1, H = page.height || 1;
  const lines = (page.lines || []).map(l => ({ s: _norm(l.s), x: l.x, y: l.y }));
  const score = (l) => {
    // 1 at the bottom-right corner, falling off towards the top-left.
    const fx = l.x / W, fy = l.y / H;
    let s = 0;
    if (fx >= 0.6) s += 0.5 * (fx - 0.6) / 0.4 + 0.3;
    if (fy >= 0.55) s += 0.5 * (fy - 0.55) / 0.45 + 0.3;
    if (fx >= 0.85 && fy < 0.55) s += 0.35;   // a title block up the right edge
    return s;
  };
  const cands = lines.map(l => ({ ...l, sc: score(l) }));
  const inBlock = cands.filter(c => c.sc >= 0.6);
  const pool = inBlock.length ? inBlock : cands;

  // Sheet id: the best-placed plausible candidate; a candidate labelled
  // "SHEET", "DWG" or "DRAWING NO" on the same line beats a bare one.
  let sheetId = '', idFrom = null, idScore = -1;
  for (const l of pool) {
    const U = l.s.toUpperCase();
    SHEET_ID_RE.lastIndex = 0; let m;
    while ((m = SHEET_ID_RE.exec(U))) {
      const raw = m[0].replace(/\s+/g, '');
      if (!_plausibleSheetId(raw, U)) continue;
      const labelled = /\b(SHEET|DWG|DRAWING)\s*(NO|NUMBER|#)?\b/.test(U) ? 0.5 : 0;
      const sc = l.sc + labelled + (/-|\./.test(raw) ? 0.15 : 0);
      if (sc > idScore) { idScore = sc; sheetId = _canonSheetId(raw); idFrom = l; }
    }
  }
  // Revision.
  let revision = '', revFrom = null, revScore = -1;
  for (const l of pool) {
    const m = REV_RE.exec(l.s);
    if (m && l.sc > revScore) { revScore = l.sc; revision = m[1].toUpperCase(); revFrom = l; }
  }
  // A bare "C" or "3" on the line straight after "REV" in a stacked block.
  if (!revision) {
    for (let i = 0; i < pool.length; i++) {
      if (/^(REV(ISION)?|ISSUE)\.?:?$/i.test(pool[i].s) && pool[i + 1] && /^([A-Z]|[0-9]{1,2})$/.test(pool[i + 1].s)) { revision = pool[i + 1].s.toUpperCase(); revFrom = pool[i + 1]; break; }
    }
  }
  // Scale.
  let scale = '', scaleFrom = null, scSc = -1;
  for (const l of pool) {
    const m = SCALE_RE.exec(l.s);
    if (m && l.sc > scSc) { scSc = l.sc; scale = _norm(m[0]).toUpperCase().replace(/\s/g, ''); scaleFrom = l; }
  }
  // Date.
  let date = '', dateFrom = null, dSc = -1;
  for (const l of pool) {
    const m = DATE_RE.exec(l.s);
    if (m && l.sc > dSc) { dSc = l.sc; date = m[1] || m[2]; dateFrom = l; }
  }
  // Title: the best-placed line that reads like a drawing title — has a
  // title word, is mostly letters, is not the project address or the firm.
  let title = '', titleFrom = null, tSc = -1;
  for (const l of pool) {
    const s = l.s;
    if (s.length < 4 || s.length > 70) continue;
    if (!TITLE_WORDS.test(s)) continue;
    if (/\b(SHEET|DWG|DRAWING)\s*(NO|NUMBER|#)/i.test(s)) continue;
    if (/\bREV(ISION)?\b|\bSCALE\b|\bDATE\b|\bDRAWN\b|\bCHECKED\b|\bPROJECT\b|\bCLIENT\b|\bJOB\s*NO\b/i.test(s)) continue;
    const letters = (s.match(/[A-Za-z]/g) || []).length / s.length;
    if (letters < 0.6) continue;
    const upper = s === s.toUpperCase() ? 0.2 : 0;
    const near = idFrom ? Math.max(0, 0.3 - Math.abs(l.y - idFrom.y) / H) : 0;
    const sc = l.sc + upper + near;
    if (sc > tSc) { tSc = sc; title = _titleCase(s); titleFrom = l; }
  }
  // A title that was just the sheet id's own line ("AO-05 ROOF PLAN") loses the id.
  if (title && sheetId) title = _norm(title.replace(new RegExp(sheetId.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'), 'i'), ''));

  let confidence = 0.2;
  if (sheetId) confidence += 0.35;
  if (title) confidence += 0.25;
  if (revision) confidence += 0.1;
  if (inBlock.length >= 3) confidence += 0.1;
  confidence = Math.min(0.95, confidence);
  const at = (l) => l ? { text: l.s, x: +(l.x / W).toFixed(3), y: +(l.y / H).toFixed(3) } : null;
  return { sheetId, title, revision, scale, date, confidence,
    from: { sheetId: at(idFrom), title: at(titleFrom), revision: at(revFrom), scale: at(scaleFrom), date: at(dateFrom) } };
}

function _canonSheetId(raw){
  // AO05 → AO-05, A1.01 kept, 'A 101' → A-101. One shape per set so the
  // register and the pages match each other.
  const m = /^([A-Z]{1,3}[0-9]?)[-–.]?([0-9]{1,3}(?:[.\-][0-9]{1,3})?)$/.exec(raw.toUpperCase());
  if (!m) return raw.toUpperCase();
  const pre = m[1], num = m[2];
  if (/[.]/.test(num)) return pre + '-' + num;
  return pre + '-' + num;
}
function _titleCase(s){
  return _norm(s).toUpperCase();
}

// Classify a page from its title (and, failing that, its text). Returns
// {cls, conf, why}. The AI pass is the authority where it runs; this is what
// stands when it does not, and what it is checked against.
function classifyHeuristic(title, fullText){
  const t = _up(title), body = _up(fullText).slice(0, 6000);
  const has = (re, s) => re.test(s || '');
  const r = (cls, conf, why) => ({ cls, conf, why });
  if (t) {
    if (has(/\b(COVER|TITLE)\s*(SHEET|PAGE)?\b/, t) && !has(/DETAIL/, t)) return r('cover', 0.9, 'title says cover');
    if (has(/\b(DRAWING|SHEET)\s*(LIST|INDEX|REGISTER|SCHEDULE)\b|\bINDEX\b|\bREGISTER\b/, t)) return r('index', 0.9, 'title says index');
    if (has(/\bROOF\b.*\b(FRAMING|PURLIN|RAFTER|TRUSS|STRUCTURE|STRUCTURAL)\b|\b(FRAMING|PURLIN|RAFTER|TRUSS)\b.*\bROOF\b/, t)) return r('roof_framing', 0.9, 'title says roof framing');
    if (has(/\bROOF\b.*\bPLAN\b|\bPLAN\b.*\bROOF\b|\bROOF (LAYOUT|SETOUT|SET OUT|OVERVIEW)\b/, t)) return r('roof_plan', 0.92, 'title says roof plan');
    if (has(/\bDETAIL/, t) && has(/\b(ROOF|GUTTER|SPOUTING|FLASHING|PARAPET|EAVE|EAVES|RIDGE|VALLEY|APRON|FASCIA|SOFFIT|BARGE|DOWNPIPE|SKYLIGHT|PENETRATION|CLADDING)\b/, t)) return r('detail_roof', 0.88, 'roofing detail by title');
    if (has(/\b(ELEVATION|ELEVATIONS)\b/, t)) return r('elevation', 0.9, 'title says elevation');
    if (has(/\bSECTION(S)?\b/, t) && !has(/\bDETAIL/, t)) return r('section', 0.85, 'title says section');
    if (has(/\bDETAIL/, t)) return r('detail_other', 0.75, 'a detail that is not roofing');
    if (has(/\bSPECIFICATION|\bSPEC\b|\bGENERAL NOTES\b|\bNOTES\b/, t)) return r('spec', 0.8, 'title says specification/notes');
    if (has(/\b(WINDOW|DOOR|FINISHES|FIXTURE|HARDWARE)\b.*\bSCHEDULE\b|\bSCHEDULE\b/, t)) return r('schedule', 0.8, 'title says schedule');
    if (has(/\bSITE\b.*\b(PLAN|LAYOUT)\b|\bLOCATION PLAN\b/, t)) return r('site_plan', 0.9, 'title says site plan');
    if (has(/\bFLOOR\b.*\bPLAN\b|\b(GROUND|FIRST|LEVEL [0-9]|UPPER|LOWER) (FLOOR )?PLAN\b|\bFLOOR LAYOUT\b/, t)) return r('floor_plan', 0.9, 'title says floor plan');
    if (has(/\b(FOUNDATION|BRACING|STRUCTURAL|STEEL|BEAM|LINTEL|SLAB|FOOTING)\b/, t)) return r('structural', 0.8, 'structural by title');
    if (has(/\b(ELECTRICAL|PLUMBING|DRAINAGE|HVAC|MECHANICAL|SERVICES|LIGHTING|SANITARY)\b/, t)) return r('services', 0.8, 'services by title');
    if (has(/\bPLAN\b/, t)) return r('floor_plan', 0.5, 'a plan of some kind');
  }
  // No usable title: the body.
  const n = (re) => (body.match(re) || []).length;
  const roofy = n(/\bROOF(ING)?\b/g), gutter = n(/\b(GUTTER|SPOUTING|DOWNPIPE|FLASHING|RIDGE|BARGE|FASCIA)\b/g);
  if (has(/\bDRAWING (LIST|INDEX|REGISTER)\b|\bSHEET (LIST|INDEX)\b/, body)) return r('index', 0.6, 'body carries a drawing register');
  if (has(/\bROOF PLAN\b/, body) && roofy >= 3) return r('roof_plan', 0.45, 'body names a roof plan');
  if (roofy + gutter >= 12) return r('detail_roof', 0.4, 'body is mostly roofing words');
  if (has(/\bELEVATION\b/, body)) return r('elevation', 0.4, 'body names an elevation');
  if (has(/\bSPECIFICATION\b/, body) && body.length > 3000) return r('spec', 0.5, 'a page of specification text');
  if (body.length < 40) return r('other', 0.3, 'no readable text (a scan or a picture)');
  return r('other', 0.3, 'nothing recognised');
}

// Parse a drawing register (cover sheet / index page) into [{sheetId, title, revision}].
// Lines like "AO-05   ROOF PLAN   C" or "AO-05  ROOF PLAN".
function parseRegister(lines){
  const out = [];
  for (const l of (lines || [])) {
    const s = _norm(l.s || l);
    const m = /^([A-Z]{1,3}[0-9]?\s?[-–.]?\s?[0-9]{1,3}(?:[.\-][0-9]{1,3})?)\s+(.+?)(?:\s+([A-Z]|[0-9]{1,2}))?$/.exec(s.toUpperCase());
    if (!m) continue;
    const id = m[1].replace(/\s+/g, '');
    if (!_plausibleSheetId(id, 'SHEET')) continue;
    const title = _norm(m[2]);
    if (!TITLE_WORDS.test(title) && title.length < 6) continue;
    out.push({ sheetId: _canonSheetId(id), title, revision: (m[3] || '').toUpperCase() });
  }
  // One entry per id — the register names a sheet once.
  const seen = new Set();
  return out.filter(e => { if (seen.has(e.sheetId)) return false; seen.add(e.sheetId); return true; });
}

// Compare two revisions: letters after numbers (NZ practice: issued 1,2,3
// for information, then A,B,C for construction) — a letter is later than
// any number, and within a kind later sorts higher. 0 when equal, null when
// one is blank (nothing to say).
function compareRevision(a, b){
  a = _up(a); b = _up(b);
  if (!a || !b) return null;
  const ka = /^[0-9]+$/.test(a) ? 0 : 1, kb = /^[0-9]+$/.test(b) ? 0 : 1;
  if (ka !== kb) return ka - kb;
  if (ka === 0) return Math.sign(parseInt(a, 10) - parseInt(b, 10));
  return a < b ? -1 : a > b ? 1 : 0;
}

// Build the set index from the classified pages.
// pages: [{pageId, fileId, fileName, pageNo, sheetId, title, revision, date, cls, conf, scale, lines?}]
// Returns {sheets:[…latest per id, with superseded:[…]], unnumbered:[…], register:[…], missing:[…], warnings:[…], counts}
function buildIndex(pages){
  const byId = new Map();
  const unnumbered = [];
  for (const p of pages) {
    const id = _up(p.sheetId);
    if (!id) { unnumbered.push(_slim(p)); continue; }
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(p);
  }
  const sheets = [], warnings = [];
  for (const [id, list] of byId) {
    list.sort((a, b) => {
      const c = compareRevision(a.revision, b.revision);
      if (c != null && c !== 0) return -c;             // latest revision first
      return (b.pageNo - a.pageNo);                   // else the later page in the file
    });
    const latest = list[0];
    const superseded = list.slice(1);
    const revs = Array.from(new Set(list.map(p => _up(p.revision)).filter(Boolean)));
    if (superseded.length) {
      const dup = superseded.filter(p => _up(p.revision) === _up(latest.revision));
      if (dup.length) warnings.push({ kind: 'duplicate', sheetId: id, text: 'Sheet ' + id + ' appears ' + list.length + ' times at the same revision; the last copy in the set is used.' });
      if (revs.length > 1) warnings.push({ kind: 'superseded', sheetId: id, text: 'Sheet ' + id + ' is in the set at revisions ' + revs.join(', ') + '; revision ' + (latest.revision || '?') + ' is used.' });
    }
    sheets.push(Object.assign(_slim(latest), { superseded: superseded.map(_slim), revisions: revs }));
  }
  sheets.sort((a, b) => _sheetSort(a.sheetId, b.sheetId));
  // The register: every index/cover page's lines, parsed.
  let register = [];
  for (const p of pages) {
    if ((p.cls === 'index' || p.cls === 'cover') && p.lines && p.lines.length) {
      const reg = parseRegister(p.lines);
      if (reg.length > register.length) register = reg;
    }
  }
  const have = new Set(sheets.map(s => s.sheetId));
  const missing = register.filter(r => !have.has(r.sheetId));
  // Mixed revisions across the set: the register says C for a sheet the set
  // carries at B, or the set's sheets are not all at one issue.
  for (const r of register) {
    const s = sheets.find(x => x.sheetId === r.sheetId);
    if (s && r.revision && s.revision && compareRevision(s.revision, r.revision) < 0)
      warnings.push({ kind: 'behind-register', sheetId: s.sheetId, text: 'The drawing register lists ' + s.sheetId + ' at revision ' + r.revision + ' but the set carries revision ' + s.revision + '.' });
  }
  const setRevs = Array.from(new Set(sheets.map(s => _up(s.revision)).filter(Boolean)));
  if (setRevs.length > 2) warnings.push({ kind: 'mixed', text: 'The set mixes revisions (' + setRevs.join(', ') + ') — check it is the issue you were asked to price.' });
  if (missing.length) warnings.push({ kind: 'missing', text: 'The drawing register lists ' + missing.length + ' sheet' + (missing.length === 1 ? '' : 's') + ' not in the files: ' + missing.map(m => m.sheetId).join(', ') + '.' });
  const counts = {};
  for (const s of sheets) counts[s.cls || 'other'] = (counts[s.cls || 'other'] || 0) + 1;
  for (const u of unnumbered) counts[u.cls || 'other'] = (counts[u.cls || 'other'] || 0) + 1;
  return { sheets, unnumbered, register, missing, warnings, counts,
    roofRelevant: sheets.concat(unnumbered).filter(p => ROOF_RELEVANT.indexOf(p.cls) >= 0).map(p => p.pageId) };
}
function _slim(p){
  return { pageId: p.pageId, fileId: p.fileId, fileName: p.fileName, pageNo: p.pageNo, sheetId: _up(p.sheetId),
    title: p.title || '', revision: _up(p.revision), date: p.date || '', scale: p.scale || '',
    cls: p.cls || 'other', conf: p.conf == null ? null : +p.conf, source: p.source || '' };
}
function _sheetSort(a, b){
  const pa = /^([A-Z]+)[0-9]?-?([0-9.]+)/.exec(a) || [], pb = /^([A-Z]+)[0-9]?-?([0-9.]+)/.exec(b) || [];
  if ((pa[1] || '') !== (pb[1] || '')) return (pa[1] || '') < (pb[1] || '') ? -1 : 1;
  const na = parseFloat(pa[2] || '0'), nb = parseFloat(pb[2] || '0');
  return na - nb || (a < b ? -1 : a > b ? 1 : 0);
}

module.exports = { CLASSES, ROOF_RELEVANT, parseTitleBlock, classifyHeuristic, parseRegister, compareRevision, buildIndex };
