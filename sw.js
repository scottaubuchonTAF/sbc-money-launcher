/* SBC Money service worker — v3.69.0 (review F15).
   The manifest says "standalone", but GitHub Pages serves index.html with
   max-age=600, so a home-screen open more than ten minutes after the last one
   re-downloaded ~409 KB before anything painted. This worker keeps the shell
   (index.html, Chart.js, icons, manifest) in a cache named after the app
   version, answers those requests cache-first, and quietly refreshes the copy
   of index.html in the background so the NEXT open has the newest shell.

   ★ SW_VERSION must equal FE_VERSION in index.html (tests pin it). A new
   deploy changes this file, the browser installs the new worker, the new
   cache is filled with the new files, and activate() deletes every older
   "sbc-" cache. The "Update available" banner in the app (U4) calls
   registration.update() and reloads, which is what makes a stale iOS
   home-screen app pick this up without a hard refresh (there is none).

   Never cached: anything that is not GET, anything cross-origin except the
   pinned Chart.js build, the Google Identity script, and every API call
   (Apps Script / Supabase are POSTs — they never touch this file). */
var SW_VERSION = 'v3.72.0';
var CACHE = 'sbc-' + SW_VERSION;
var CHART_JS = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
var SHELL = ['./', './index.html', './manifest.json'];                        // required — install fails without these
var EXTRAS = ['./icon-192.png', './icon-512.png', './apple-touch-icon.png'];  // best-effort — a missing icon must never block the shell

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Chart.js is cross-origin with no CORS headers → an opaque response, which
      // is still cacheable and still runs as a <script>. no-cors is required.
      // cache:'reload' bypasses the HTTP cache: Pages serves max-age=600, and a
      // precache that read the browser's copy could install a NEW worker holding
      // the OLD index.html (seen in the v3.69.0 smoke test). Always go to the server.
      var fresh = function (u) { return new Request(u, { cache: 'reload' }); };
      var chart = c.add(new Request(CHART_JS, { mode: 'no-cors' })).catch(function () {});
      var extras = EXTRAS.map(function (u) { return c.add(fresh(u)).catch(function () {}); });
      return Promise.all([c.addAll(SHELL.map(fresh)), chart].concat(extras));
    }).then(function () { return self.skipWaiting(); })
    .catch(function (e) { console.error('SBC sw install failed:', e && e.message || e); throw e; })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('sbc-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isShell_(req) {
  if (req.method !== 'GET') return false;
  if (req.url === CHART_JS) return true;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return false;
  if (req.mode === 'navigate') return true;
  return /\/(index\.html|manifest\.json|icon-192\.png|icon-512\.png|apple-touch-icon\.png)$/.test(u.pathname) || u.pathname === '/';
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (!isShell_(req)) return;                       // everything else: straight to the network, untouched
  var isPage = req.mode === 'navigate' || /\/(index\.html)?$/.test(new URL(req.url).pathname);
  var key = isPage ? './index.html' : req;
  ev.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(key).then(function (hit) {
        // the page's background refresh also skips the HTTP cache (no-cache = revalidate with the server)
        var net = fetch(isPage ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) c.put(key, res.clone()).catch(function () {});
          return res;
        });
        if (hit) {
          // stale-while-revalidate for the page: paint the cached shell now, refresh the copy for next time
          if (isPage) ev.waitUntil(net.catch(function () {}));
          return hit;
        }
        return net;
      });
    })
  );
});
