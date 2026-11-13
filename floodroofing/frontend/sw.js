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
var SW_VERSION = 'roofmap-v6';
var SHELL = SW_VERSION + '-shell';
var ASSETS = SW_VERSION + '-assets';
var NET_TIMEOUT = 5000;   // ms before we fall back to the cached copy

var PRECACHE = [
  // NOT '/' — the root serves the landing page now, and the offline shell is
  // the app. /app is what an installed RoofMap launches.
  '/app',
  '/sheet-plan.js',
  '/help-bot.js',
  '/tender.js',
  '/manifest.webmanifest',
  '/demo-job.json',
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

// `ev` keeps the worker alive until the fresh copy is IN the cache. Without
// it, a phone on a slow connection got the cached shell at 5 s, the event
// ended, the worker was stopped mid-download and the cache was never
// refreshed — so it opened the same old build every time (2026-11-13: the
// owner's phone two days behind).
function fromNetworkFirst(req, cacheName, fallbackReq, ev){
  return caches.open(cacheName).then(function(cache){
    return cache.match(fallbackReq || req).then(function(cached){
      var timedOut = false, putP = null;
      var net = fetch(req).then(function(res){
        if (res && res.ok && res.type === 'basic'){
          try { putP = cache.put(fallbackReq || req, res.clone()).catch(function(){}); } catch(e){}
        }
        return res;
      });
      try { if (ev) ev.waitUntil(net.then(function(){ return putP; }).catch(function(){})); } catch(e){}
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
  // The crew app (/crew) has its own worker; this one never answers for it,
  // or a navigation there would be cached as the office app's '/app'.
  if (/^\/crew(\.|-|\/|$)/.test(url.pathname)) return;

  // Page loads: always try the live site first so a pushed fix shows up,
  // and fall back to the cached shell when the signal is gone. Customer
  // quote links (?q=) carry a token — never cache those under '/'.
  if (req.mode === 'navigate'){
    if (url.searchParams.has('q')) return;
    // Only the APP is kept as the offline shell. The landing, pricing and
    // the other public pages used to be stored under '/app' too, so a phone
    // that last visited the home page could open the office app as it.
    var isApp = /^\/(app|app\.html|index\.html)$/.test(url.pathname) ||
      (url.pathname === '/' && (url.searchParams.has('reset') || url.searchParams.has('invite')));
    e.respondWith(
      (isApp ? fromNetworkFirst(req, SHELL, new Request('/app'), e) : fromNetworkFirst(req, SHELL, null, e))
        .catch(function(){ return caches.match(isApp ? '/app' : req); })
    );
    return;
  }

  // Brand images don't change — serve them instantly.
  if (/\.(png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname)){
    e.respondWith(fromCacheFirst(req, ASSETS));
    return;
  }

  // The app's own JS must track app.html, so it gets the same
  // fresh-first treatment rather than a stale-while-revalidate mismatch.
  if (/\.(js|css|webmanifest|json)$/i.test(url.pathname)){
    e.respondWith(fromNetworkFirst(req, SHELL, null, e));
    return;
  }
});
