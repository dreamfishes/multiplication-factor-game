const CACHE_NAME = 'english-quiz-pwa-v3';
const CORE_ASSETS = [
  './',
  './英语闯关小游戏.html?v=20260622-pwa',
  './manifest.webmanifest?v=20260622-pwa',
  './assets/pwa/icon-180.png?v=20260622-pwa',
  './assets/pwa/icon-192.png?v=20260622-pwa',
  './assets/pwa/icon-512.png?v=20260622-pwa'
];

function shouldCache(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return false;
  const path = decodeURIComponent(url.pathname);
  return path.includes('/英语/assets/audio/en/')
    || path.includes('/英语/assets/en/')
    || path.includes('/英语/assets/pwa/')
    || path.endsWith('/英语/manifest.webmanifest')
    || path.endsWith('/英语/英语闯关小游戏.html');
}

async function cacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    urls.map(url => cache.add(url).catch(() => null))
  );
}

self.addEventListener('install', event => {
  event.waitUntil(cacheUrls(CORE_ASSETS).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (!shouldCache(event.request)) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response && response.ok) cache.put(event.request, response.clone());
      return response;
    })
  );
});

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'CACHE_URLS' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(cacheUrls(event.data.urls));
});
