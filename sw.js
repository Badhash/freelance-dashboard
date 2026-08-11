// ============================================================
// Service Worker — Pilotage Freelance (PWA app-shell)
//
// Stratégies :
//  - Navigations (HTML)        -> network-first + fallback cache
//  - Assets statiques (origine) -> stale-while-revalidate
//  - Polices Google (gstatic)   -> cache-on-fetch (runtime)
//  - Tout autre cross-origin    -> laissé passer, jamais intercepté
//                                  (Supabase, API Google Fonts, CDN…)
// ============================================================

const CACHE = 'pilotage-v4';
const FONT_CACHE = 'pilotage-fonts-v1';

// App-shell même origine pré-cachée à l'installation.
const APP_SHELL = [
  '.',
  'index.html',
  'styles.css',
  'data.js',
  'render-balance.js',
  'render-stats.js',
  'render-months.js',
  'render-projection.js',
  'render.js',
  'main.js',
  'favicon.svg',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'apple-touch-icon.png',
];

// ---- INSTALL : pré-cache de l'app-shell ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll échoue en bloc si une ressource manque : on tolère les absences.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

// ---- ACTIVATE : purge des anciens caches versionnés ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE && k !== FONT_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---- FETCH ----
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navigations -> network-first (pour récupérer les mises à jour), fallback cache.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  // Assets même origine -> stale-while-revalidate.
  if (sameOrigin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Polices Google (fichiers .woff2 sur gstatic) -> cache-on-fetch runtime.
  if (url.host === 'fonts.gstatic.com') {
    event.respondWith(cacheOnFetch(req, FONT_CACHE));
    return;
  }

  // Tout autre cross-origin (Supabase, API fonts.googleapis, CDN jsdelivr…)
  // : on ne l'intercepte pas — laisser le réseau gérer normalement.
});

function networkFirst(req) {
  return fetch(req)
    .then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    })
    .catch(() =>
      caches.match(req).then((cached) => cached || caches.match('index.html'))
    );
}

function staleWhileRevalidate(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}

function cacheOnFetch(req, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          cache.put(req, res.clone());
        }
        return res;
      });
    })
  );
}
