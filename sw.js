/* =============================================
   SERVICE WORKER
   App shell + diary: network first, cached copy when offline.
   TMDB posters and API calls are left to the browser's own HTTP cache.
   Bump VERSION when shell files change to drop the old cache.
   ============================================= */
const VERSION      = 'v1';
const SHELL_CACHE  = `films-shell-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'web.js',
  'diary.csv',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('films-shell-') && k !== SHELL_CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    // Navigation requests can't be re-issued with options, so refetch by URL
    const res = await fetch(req.url, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return cache.match('index.html');
    throw err;
  }
}
