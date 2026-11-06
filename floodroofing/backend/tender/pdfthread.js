// One reading thread for tender/pdfpool.js: opens its own copy of the PDF
// and answers each page number with pdf.pageAssets().
'use strict';
const { parentPort, workerData } = require('worker_threads');
const pdf = require('./pdf');
let doc = null;
(async () => {
  try { doc = await pdf.open(workerData.data); }
  catch (e) { parentPort.postMessage({ openError: 'not a PDF that can be opened: ' + String(e && e.message || e) }); return; }
  parentPort.postMessage({ ready: true });
})();
parentPort.on('message', async (m) => {
  if (!m || m.quit) { try { if (doc) await doc.destroy(); } catch (e) {} process.exit(0); }
  try {
    const a = await pdf.pageAssets(doc, m.pageNo, workerData.opts);
    const transfer = [];
    for (const k of ['img', 'thumb', 'tile']) if (a[k]) { const b = new Uint8Array(a[k].buf); a[k].buf = b; transfer.push(b.buffer); }
    parentPort.postMessage({ pageNo: m.pageNo, assets: a }, transfer);
  } catch (e) {
    parentPort.postMessage({ error: 'page ' + m.pageNo + ': ' + String(e && e.message || e) });
  }
});
