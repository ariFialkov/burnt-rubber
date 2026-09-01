// Network-first service worker with a cache fallback: online you always get
// the freshly deployed build, offline the cached copy plays fully (the whole
// game is static and deterministic — races run off the world clock).

const CACHE = 'burnt-rubber-v2';
const ASSETS = [
  '.',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'vendor/three.module.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'src/main.js',
  'src/core/rng.js',
  'src/data/names.js',
  'src/data/tours.js',
  'src/data/racers.js',
  'src/engine/schedule.js',
  'src/engine/odds.js',
  'src/engine/script.js',
  'src/engine/bets.js',
  'src/three/trackGen.js',
  'src/three/carFactory.js',
  'src/three/scene.js',
  'src/three/cameras.js',
  'src/ui/avatars.js',
  'src/ui/hub.js',
  'src/ui/slip.js',
  'src/ui/board.js',
  'src/ui/live.js',
  'src/ui/garage.js',
  'src/ui/mybets.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  // Network first so a new deploy is picked up on the next load; the cache is
  // refreshed on every success and serves as the offline fallback.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || caches.match('index.html', { ignoreSearch: true }))
      )
  );
});
