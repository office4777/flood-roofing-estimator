// AI Tendering — where the plan files live.
//
// A Supabase Storage bucket, PRIVATE, created at boot if it is not there.
// Objects are keyed {company_id}/{tender_id}/… so a path is scoped before
// anything reads it. The browser never sends a file through Railway: the
// server signs an upload URL for one exact path and the browser PUTs the
// file straight to Storage; reads come back the same way (signed, short).
//
// Test seam: globalThis.__TEST_TENDER_STORAGE = await memory() — the same
// five methods over a Map, with a tiny HTTP server standing in for the
// signed PUT so the upload path is exercised for real.
'use strict';
const BUCKET = process.env.TENDER_BUCKET || 'tender-docs';
const MAX_BYTES = 100 * 1024 * 1024;

function create(supabase){
  if (globalThis.__TEST_TENDER_STORAGE) return globalThis.__TEST_TENDER_STORAGE;
  const st = () => supabase.storage;
  let ensured = null;
  async function ensureBucket(){
    if (ensured) return ensured;
    ensured = (async () => {
      const { data } = await st().getBucket(BUCKET);
      if (data) return true;
      const r = await st().createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
      if (r.error && !/already exists|duplicate/i.test(r.error.message || '')) throw r.error;
      return true;
    })().catch(e => { ensured = null; throw e; });
    return ensured;
  }
  return {
    bucket: BUCKET, maxBytes: MAX_BYTES, ensureBucket,
    async signUpload(path){
      await ensureBucket();
      const { data, error } = await st().from(BUCKET).createSignedUploadUrl(path);
      if (error) throw error;
      return { signedUrl: data.signedUrl, token: data.token, path };
    },
    async upload(path, buf, mime){
      await ensureBucket();
      const { error } = await st().from(BUCKET).upload(path, buf, { contentType: mime || 'application/octet-stream', upsert: true });
      if (error) throw error;
      return path;
    },
    async download(path){
      const { data, error } = await st().from(BUCKET).download(path);
      if (error) throw error;
      return Buffer.from(await data.arrayBuffer());
    },
    async signedUrl(path, seconds){
      const { data, error } = await st().from(BUCKET).createSignedUrl(path, seconds || 600);
      if (error) throw error;
      return data.signedUrl;
    },
    async remove(paths){
      if (!paths || !paths.length) return;
      const { error } = await st().from(BUCKET).remove(paths);
      if (error) throw error;
    },
  };
}

// In-memory stand-in for the suites. `files` is the Map the tests read.
async function memory(){
  const http = require('http');
  const files = new Map();
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const key = decodeURIComponent(u.pathname.replace(/^\/obj\//, ''));
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'PUT') { files.set(key, { buf: Buffer.concat(chunks), mime: req.headers['content-type'] || '' }); res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"Key":"' + key + '"}'); }
      if (req.method === 'GET') { const f = files.get(key); if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': f.mime || 'application/octet-stream' }); return res.end(f.buf); }
      res.writeHead(405); res.end();
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/obj/';
  return {
    bucket: 'test', maxBytes: MAX_BYTES, files, base, close: () => srv.close(),
    async ensureBucket(){ return true; },
    async signUpload(path){ return { signedUrl: base + encodeURIComponent(path) + '?token=t', token: 't', path }; },
    async upload(path, buf, mime){ files.set(path, { buf: Buffer.from(buf), mime: mime || '' }); return path; },
    async download(path){ const f = files.get(path); if (!f) throw new Error('not found: ' + path); return f.buf; },
    async signedUrl(path){ return base + encodeURIComponent(path) + '?token=t'; },
    async remove(paths){ for (const p of (paths || [])) files.delete(p); },
  };
}

module.exports = { create, memory, BUCKET, MAX_BYTES };
