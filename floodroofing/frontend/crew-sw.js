// THE CREW APP'S SERVICE WORKER (2026-11-13). Its own scope (/crew) so it
// never touches the office app's sw.js. Network first with a 5 s wait, so a
// new build reaches the phone on the next open with signal; the last copy
// when there is none. The API is another origin and is never touched here —
// the app keeps its own data on the phone.
const CACHE = 'crew-v2';
const SHELL = ['/crew', '/crew.webmanifest', '/brand/pwa-192.png', '/brand/pwa-512.png', '/brand/roofmap_icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('crew-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = (req.mode === 'navigate') ? '/crew' : req;
  // The network copy is written to the cache inside e.waitUntil, called now, so the
  // worker is kept alive until it lands even when the cached copy answered first
  // (a 5 MB page on a slow line — the office app's sw.js lesson, 2026-11-13).
  let putP = Promise.resolve();
  const net = fetch(req).then(r => {
    if (r && r.ok) { const cp = r.clone(); putP = caches.open(CACHE).then(c => c.put(key, cp)).catch(() => {}); }
    return r;
  });
  e.waitUntil(net.then(() => putP, () => {}));
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fromCache = () => caches.match(key).then(r => r || caches.match(req)).then(r => { if (!done && r) { done = true; resolve(r); } return r; });
    const t = setTimeout(fromCache, 5000);
    net.then(r => {
      clearTimeout(t);
      if (!done) { done = true; resolve(r); }
    }).catch(() => { clearTimeout(t); fromCache().then(r => { if (!done) { done = true; resolve(r || new Response('Offline', { status: 503 })); } }); });
  }));
});
