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
const DEFAULT_BUCKET = process.env.TENDER_BUCKET || 'tender-docs';
const BUCKET = DEFAULT_BUCKET;
const MAX_BYTES = 100 * 1024 * 1024;

// A bucket's own limit may not be above the PROJECT's upload limit (Supabase
// → Storage → Settings; 50 MB on the Free plan), and Storage refuses such a
// bucket with "The object exceeded the maximum allowed size" — the message
// the first real upload got on 2026-10-27, on a 14 MB file, because the
// bucket could not be made at 100 MB and every sign failed with it. So the
// bucket is made (or corrected) at the largest of these the project takes,
// and that figure is the limit the route enforces and the tab shows.
const LIMIT_STEPS = [MAX_BYTES, 50 * 1024 * 1024, 25 * 1024 * 1024];
const _tooBig = e => /exceeded the maximum allowed size|too large|EntityTooLarge|413/i.test(String((e && (e.message || e.error || e.statusCode)) || e || ''));

// opts: { bucket, seam } — the job's Files & Photos (2026-10-27) keep their
// own private bucket through the same five methods (bucket 'job-files', test
// seam globalThis.__TEST_JOBFILES_STORAGE). Called bare, it is the tender's.
function create(supabase, opts){
  opts = opts || {};
  const seam = opts.seam || '__TEST_TENDER_STORAGE';
  if (globalThis[seam]) return globalThis[seam];
  const BUCKET = opts.bucket || DEFAULT_BUCKET;
  const st = () => supabase.storage;
  let ensured = null;
  let limit = LIMIT_STEPS[1];  // until the bucket says, the project default
  async function ensureBucket(){
    if (ensured) return ensured;
    ensured = (async () => {
      const { data } = await st().getBucket(BUCKET);
      const have = data ? (+data.file_size_limit || 0) : 0;
      if (data && have >= MAX_BYTES) { limit = have; return true; }
      let lastErr = null;
      for (const n of LIMIT_STEPS) {
        if (data && have && n <= have) { limit = have; return true; }
        const r = data ? await st().updateBucket(BUCKET, { public: false, fileSizeLimit: n })
                       : await st().createBucket(BUCKET, { public: false, fileSizeLimit: n });
        if (!r.error || /already exists|duplicate/i.test(r.error.message || '')) { limit = n; return true; }
        lastErr = r.error;
        if (!_tooBig(r.error)) break;
      }
      if (data) { limit = have || LIMIT_STEPS[2]; return true; }
      throw lastErr || new Error('could not make the ' + BUCKET + ' bucket');
    })().catch(e => { ensured = null; throw e; });
    return ensured;
  }
  return {
    bucket: BUCKET, ensureBucket,
    get maxBytes(){ return limit; },
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
