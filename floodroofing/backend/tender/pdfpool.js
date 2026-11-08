// AI Tendering — reading a plan set's pages on more than one core.
//
// Rasterising an A1 sheet is close to a second of pure CPU, and in the
// server's own thread every one of those seconds held up every other
// request RoofMap was answering. Each page is read on a worker thread
// instead, several at once (2026-11-06, "speed up the pdf reader"): each
// thread opens its own copy of the PDF and answers page numbers with
// pdf.pageAssets(). Pages come back in whatever order they finish; the
// caller records each as it lands. Threads unavailable, or switched off
// with TENDER_PDF_THREADS=0, and the pages are read here one at a time,
// exactly as before.
'use strict';
const os = require('os');
const path = require('path');
const pdf = require('./pdf');

function threadCount(){
  const env = process.env.TENDER_PDF_THREADS;
  if (env !== undefined && env !== '') return Math.max(0, Math.min(8, +env || 0));
  const n = (os.availableParallelism ? os.availableParallelism() : os.cpus().length) || 1;
  return Math.max(1, Math.min(4, n - 1));
}

// pages: page numbers to read. onPage(pageNo, assets) is awaited for each,
// one at a time, in the order they finish. Throws the first page error.
async function readPages(buf, doc, pages, opts, onPage){
  const n = Math.min(threadCount(), pages.length);
  if (n < 1 || pages.length < 2) return inline(doc, pages, opts, onPage);
  let Worker;
  try { ({ Worker } = require('worker_threads')); } catch (e) { return inline(doc, pages, opts, onPage); }
  const queue = pages.slice();
  const workers = [];
  let chain = Promise.resolve(), failed = null, started = 0;
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  await new Promise((resolve) => {
    let live = 0;
    const finish = () => { if (--live === 0) resolve(); };
    for (let i = 0; i < n; i++) {
      let w;
      try { w = new Worker(path.join(__dirname, 'pdfthread.js'), { workerData: { data: bytes, opts } }); }
      catch (e) { break; }
      workers.push(w); live++; started++;
      let current = null;
      const next = () => {
        if (failed || !queue.length) { current = null; w.postMessage({ quit: true }); return; }
        current = queue.shift(); w.postMessage({ pageNo: current });
      };
      w.on('message', (m) => {
        if (m && m.ready) { next(); return; }
        // A thread that could not open the file is no thread at all: its
        // share goes to the others, or is read here at the end.
        if (m && m.openError) { current = null; w.postMessage({ quit: true }); return; }
        if (m && m.error) { failed = failed || new Error(m.error); current = null; w.postMessage({ quit: true }); return; }
        const pageNo = m.pageNo, a = m.assets;
        for (const k of ['img', 'thumb', 'tile']) if (a[k]) a[k].buf = Buffer.from(a[k].buf);
        chain = chain.then(() => failed ? null : onPage(pageNo, a)).catch(e => { failed = failed || e; });
        current = null;
        next();
      });
      // A thread that dies hands its page back; the others carry on.
      w.on('error', (e) => { if (current != null) queue.unshift(current); current = null; });
      w.on('exit', () => { if (current != null) queue.unshift(current); finish(); });
    }
    if (!live) resolve();
  });
  await chain;
  if (failed) throw failed;
  // Whatever no thread got to (none could start, or they all died).
  if (queue.length) await inline(doc, queue, opts, onPage);
}

async function inline(doc, pages, opts, onPage){
  for (const pageNo of pages) await onPage(pageNo, await pdf.pageAssets(doc, pageNo, opts));
}

module.exports = { readPages, threadCount };
