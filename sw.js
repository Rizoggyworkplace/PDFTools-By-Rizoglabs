/* PDF Tools — service worker.
 * Strategi aman (hindari konten basi):
 *  - navigasi (HTML): network-first, fallback ke cache
 *  - aset lokal (css/js/manifest/ikon): cache-first, lalu update dari network
 *  - CDN (pdf.js/pdf-lib/jszip/fonts): stale-while-revalidate
 */
const CACHE = "pdf-tools-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/css/style.css",
  "./assets/js/app.js",
  "./assets/js/pdfutil.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // jangan gagal total bila satu aset 404
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isCdn(url) {
  return /^(https:\/\/cdn\.jsdelivr\.net|https:\/\/fonts\.googleapis\.com|https:\/\/fonts\.gstatic\.com)/.test(url);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // hanya tangani origin sendiri + CDN yang dikenal
  if (url.origin !== self.location.origin && !isCdn(req.url)) return;

  if (req.mode === "navigate") {
    // HTML: selalu coba network dulu agar tidak basi
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (isCdn(req.url)) {
    // CDN: stale-while-revalidate
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // aset lokal: cache-first, fallback network
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
