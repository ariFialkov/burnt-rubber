// Network-first service worker with a cache fallback: online you always get
// the freshly deployed build, offline the cached copy plays fully (the whole
// game is static and deterministic — races run off the world clock).

const CACHE = 'burnt-rubber-v8';
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
  'src/ui/tickets.js',
  'src/three/models.js',
  'src/three/cockpit.js',
  'vendor/jsm/loaders/GLTFLoader.js',
  'vendor/jsm/utils/BufferGeometryUtils.js',
  'vendor/jsm/environments/RoomEnvironment.js',
  'assets/models/formula.glb',
  'assets/models/stock.glb',
  'assets/models/rally.glb',
  'assets/models/baja.glb',
  'assets/models/moto.glb',
  'assets/models/rider.glb',
  'assets/models/driver.glb',
  'assets/liveries/index.json',
  'assets/liveries/formula.jpg',
  'assets/liveries/formula_normal.jpg',
  'assets/liveries/formula_rm.jpg',
  'assets/liveries/stock.jpg',
  'assets/liveries/stock_normal.jpg',
  'assets/liveries/stock_rm.jpg',
  'assets/liveries/rally.jpg',
  'assets/liveries/rally_normal.jpg',
  'assets/liveries/rally_rm.jpg',
  'assets/liveries/baja.jpg',
  'assets/liveries/baja_normal.jpg',
  'assets/liveries/baja_rm.jpg',
  'assets/liveries/moto.jpg',
  'assets/liveries/moto_normal.jpg',
  'assets/liveries/moto_rm.jpg',
  'assets/liveries/rider.jpg',
  'assets/liveries/rider_normal.jpg',
  'assets/liveries/rider_rm.jpg',
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
