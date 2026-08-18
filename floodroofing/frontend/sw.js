/* RoofMap service worker — offline shell + fresh-first updates.
 *
 * Two jobs:
 *   1. The app opens on a roof with no signal (installed from the home
 *      screen, straight to the canvas).
 *   2. It never serves a stale build when there IS signal — fixes pushed to
 *      main must land on the tablet on the next open, not two opens later.
 *
 * So: network-first with a short timeout for the app shell (fresh when
 * online, cached when not), cache-first only for brand images that never
 * change. Anything cross-origin — the API, Supabase, Google Maps — goes
 * straight to the network and is never cached.
 *
 * Bump SW_VERSION when the precache list changes; old caches are dropped
 * on activate.
 */
var SW_VERSION = 'roofmap-v1';
var SHELL = SW_VERSION + '-shell';
var ASSETS = SW_VERSION + '-assets';
var NET_TIMEOUT = 5000;   // ms before we fall back to the cached copy

var PRECACHE = [
  '/',
  '/index.html',
  '/sheet-plan.js',
  '/help-bot.js',
  '/manifest.webmanifest',
  '/brand/roofmap_icon.png',
  '/brand/pwa-192.png',
  '/brand/pwa-512.png',
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(SHELL)
      // addAll is all-or-nothing; one 404 would leave us with no offline
      // shell at all, so each entry is fetched independently.
      .then(function(c){
        return Promise.all(PRECACHE.map(function(u){
          return c.add(new Request(u, { cache: 'reload' })).catch(function(){});
        }));
      })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.map(function(k){
          if (k !== SHELL && k !== ASSETS) return caches.delete(k);
        }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

// Lets the page ask a waiting worker to take over immediately.
self.addEventListener('message', function(e){
  if (e.data === 'skip-waiting') self.skipWaiting();
});

function fromNetworkFirst(req, cacheName, fallbackReq){
  return caches.open(cacheName).then(function(cache){
    return cache.match(fallbackReq || req).then(function(cached){
      var timedOut = false;
      var net = fetch(req).then(function(res){
        if (res && res.ok && res.type === 'basic'){
          try { cache.put(fallbackReq || req, res.clone()); } catch(e){}
        }
        return res;
      });
      if (!cached) return net;
      // Race the network against the clock: whichever answers first wins,
      // but the network response still refreshes the cache either way.
      return new Promise(function(resolve){
        var timer = setTimeout(function(){ timedOut = true; resolve(cached); }, NET_TIMEOUT);
        net.then(function(res){
          clearTimeout(timer);
          if (!timedOut) resolve(res);
        }).catch(function(){
          clearTimeout(timer);
          if (!timedOut) resolve(cached);
        });
      });
    });
  });
}

function fromCacheFirst(req, cacheName){
  return caches.open(cacheName).then(function(cache){
    return cache.match(req).then(function(cached){
      if (cached) return cached;
      return fetch(req).then(function(res){
        if (res && res.ok) { try { cache.put(req, res.clone()); } catch(e){} }
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;                       // saves, uploads, logins
  var url;
  try { url = new URL(req.url); } catch(err){ return; }
  if (url.origin !== self.location.origin) return;        // API / Supabase / Maps / fonts

  // Page loads: always try the live site first so a pushed fix shows up,
  // and fall back to the cached shell when the signal is gone. Customer
  // quote links (?q=) carry a token — never cache those under '/'.
  if (req.mode === 'navigate'){
    if (url.searchParams.has('q')) return;
    e.respondWith(
      fromNetworkFirst(req, SHELL, new Request('/index.html'))
        .catch(function(){ return caches.match('/index.html'); })
    );
    return;
  }

  // Brand images don't change — serve them instantly.
  if (/\.(png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname)){
    e.respondWith(fromCacheFirst(req, ASSETS));
    return;
  }

  // The app's own JS must track index.html, so it gets the same
  // fresh-first treatment rather than a stale-while-revalidate mismatch.
  if (/\.(js|css|webmanifest|json)$/i.test(url.pathname)){
    e.respondWith(fromNetworkFirst(req, SHELL));
    return;
  }
});
