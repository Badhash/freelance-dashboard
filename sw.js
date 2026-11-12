// ============================================================
// Service Worker — Pilotage Freelance (PWA app-shell)
//
// Stratégies :
//  - Navigations (HTML)                 -> network-first + fallback cache
//  - Assets statiques (origine)         -> stale-while-revalidate
//  - Feuille Google Fonts (googleapis)  -> stale-while-revalidate (cache des polices)
//  - Polices Google (gstatic)           -> cache-on-fetch (cache des polices)
//  - Tout autre cross-origin            -> laissé passer, jamais intercepté
//                                          (Supabase, CDN…)
// ============================================================

const CACHE = 'pilotage-v9';
// Versionné avec les polices : v2 = Manrope + Geist Mono (v1 = Fraunces, Inter Tight, JetBrains Mono,
// purgées à l'activation).
const FONT_CACHE = 'pilotage-fonts-v2';

// App-shell même origine pré-cachée à l'installation.
const APP_SHELL = [
  '.',
  'index.html',
  'css/tokens.css?v=9',
  'css/base.css?v=9',
  'css/shell.css?v=9',
  'css/hero.css?v=9',
  'css/activity.css?v=9',
  'css/months.css?v=9',
  'css/projection.css?v=9',
  'css/overlays.css?v=9',
  'data.js?v=9',
  'icons.js?v=9',
  'charts.js?v=9',
  'render-balance.js?v=9',
  'render-stats.js?v=9',
  'render-months.js?v=9',
  'render-projection.js?v=9',
  'render-overlays.js?v=9',
  'render.js?v=9',
  'supabase-config.js?v=9',
  'supabase-crypto.js?v=9',
  'supabase-sync.js?v=9',
  'main.js?v=9',
  'vendor/supabase-js-2.118.0.js',
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
          // Uniquement NOS anciens caches : Cache Storage est partagé par toute
          // l'origine (toutes les pages <compte>.github.io), la purge sans
          // préfixe effaçait aussi les caches des autres applications.
          .filter((k) => k.startsWith('pilotage-') && k !== CACHE && k !== FONT_CACHE)
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

  // Feuille Google Fonts : sans elle, @font-face n'est pas déclaré hors ligne et les
  // .woff2 en cache ne servent à rien. Requête no-cors : réponse opaque acceptée.
  if (url.host === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }

  // Polices Google (fichiers .woff2 sur gstatic) -> cache-on-fetch runtime.
  if (url.host === 'fonts.gstatic.com') {
    event.respondWith(cacheOnFetch(req, FONT_CACHE));
    return;
  }

  // Tout autre cross-origin (Supabase…)
  // : on ne l'intercepte pas — laisser le réseau gérer normalement.
});

function networkFirst(req) {
  return fetch(req)
    .then((res) => {
      // Seule une réponse valide est mise en cache : une 404 ou une erreur
      // serveur restait servie hors ligne à la place de l'app.
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    })
    .catch(() =>
      caches.match(req).then((cached) => cached || caches.match('index.html'))
    );
}

function staleWhileRevalidate(req, cacheName = CACHE) {
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) cache.put(req, res.clone());
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
