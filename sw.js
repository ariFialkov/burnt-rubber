// Cache-first service worker: the whole game is static and deterministic,
// so once cached it plays fully offline (races run off the world clock).

const CACHE = 'burnt-rubber-v1';
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
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) =>
      hit ||
      fetch(e.request).then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
    )
  );
});
