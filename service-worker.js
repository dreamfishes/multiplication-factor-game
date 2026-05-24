const CACHE_NAME = "factor-squad-20260524-v15";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=11",
  "./app.js?v=11",
  "./manifest.webmanifest",
  "./app-icon.svg",
  "./bgm.mp3",
  "./点击答案音效.mp3",
  "./没有选择就提交.mp3",
  "./答对音效.mp3",
  "./答错音效.mp3",
  "./最后结算庆祝.mp3",
  "./姐姐.png",
  "./妹妹.png",
  "./dinosaur.png",
  "./princess.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS.map((asset) => new URL(asset, self.registration.scope))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === "opaque") {
          return response;
        }

        const responseCopy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
        return response;
      });
    })
  );
});
