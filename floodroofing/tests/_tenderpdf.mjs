// A tiny PDF writer for the AI Tendering suites: Helvetica text at given
// positions, one or more pages. Enough to carry a title block, a drawing
// register and a page with no text at all. Not a suite — a helper.
//
// mkPdf([{ w, h, texts: [{ x, y, size, str }] }])  → Buffer
// (x, y) are PDF points from the BOTTOM-left, as PDF has it.
export function mkPdf(pages){
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const p of pages) {
    const esc = (s) => String(s).replace(/[\\()]/g, m => '\\' + m);
    const stream = (p.texts || []).map(t => `BT /F1 ${t.size || 10} Tf ${t.x} ${t.y} Td (${esc(t.str)}) Tj ET`).join('\n') +
      (p.rect ? `\n${p.rect.join(' ')} re S` : '');
    const cId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pId = add(`__PAGE__ /Contents ${cId} 0 R /MediaBox [0 0 ${p.w} ${p.h}]`);
    kids.push(pId);
  }
  const pagesObj = add(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
  for (const k of kids) objs[k - 1] = objs[k - 1].replace('__PAGE__', `<< /Type /Page /Parent ${pagesObj} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >>`) + ' >>';
  const catId = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'binary');
}

// An A1 landscape sheet (2384 x 1684 pt) with a title block bottom-right.
export function sheet(opts){
  const W = 2384, H = 1684;
  const t = [];
  const bx = W - 520, by = 40;   // title block origin, bottom-right
  if (opts.title) t.push({ x: bx, y: by + 120, size: 22, str: opts.title });
  if (opts.sheetId) t.push({ x: bx, y: by + 60, size: 16, str: 'SHEET NO ' + opts.sheetId });
  if (opts.rev) t.push({ x: bx + 260, y: by + 60, size: 14, str: 'REV ' + opts.rev });
  if (opts.scale) t.push({ x: bx, y: by + 20, size: 11, str: 'SCALE ' + opts.scale });
  if (opts.date) t.push({ x: bx + 260, y: by + 20, size: 11, str: 'DATE ' + opts.date });
  t.push({ x: bx, y: by + 160, size: 12, str: opts.project || 'WHANGAROA COMMUNITY HALL' });
  t.push({ x: bx, y: by + 185, size: 10, str: opts.firm || 'NORTHLAND ARCHITECTS LTD' });
  (opts.body || []).forEach((s, i) => t.push({ x: 120, y: H - 160 - i * 28, size: 13, str: s }));
  return { w: W, h: H, texts: opts.blank ? [] : t, rect: opts.rect };
}
