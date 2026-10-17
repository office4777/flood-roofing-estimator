// My Day — service worker.
//
// Two jobs, and only two:
//   1. The app opens on a roof with no signal. The shell is cached, and the
//      plan itself lives in localStorage, so the whole thing works offline.
//   2. A new build reaches him without being asked for. The page is fetched
//      network-FIRST with a short timeout, so a reload picks up a change;
//      the cache is only there for when the network is not.
//
// The API is never cached. A stale plan is worse than no plan, and the app
// already keeps its own copy of the list.
const CACHE = 'myday-v1';
const SHELL = ['MyDay.html', 'myday.webmanifest', 'myday-icon.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Anything that is not our own folder (the API above all) goes straight
  // to the network and is never stored.
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    try {
      const net = await Promise.race([
        fetch(req),
        new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 5000)),
      ]);
      if (net && net.ok) {
        const copy = net.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return net;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      // A navigation with nothing cached for that exact URL still deserves
      // the app rather than the browser's dinosaur.
      if (req.mode === 'navigate') {
        const shell = await caches.match('MyDay.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
