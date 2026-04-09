// ── VMA Tracker — Service Worker ──
// Version du cache : à incrémenter à chaque déploiement
const CACHE_NAME = 'vma-tracker-v1';

// Fichiers à mettre en cache lors de l'installation
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Bibliothèques CDN (mise en cache au premier chargement)
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js'
];

// Polices Google Fonts (mises en cache dynamiquement)
const FONT_CACHE_NAME = 'vma-tracker-fonts-v1';

// ── Installation : mise en cache des ressources essentielles ──
self.addEventListener('install', event => {
  console.log('[SW] Installation…');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Mise en cache des ressources locales');
      // On cache les fichiers locaux de façon sûre (un échec n'empêche pas l'install)
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Impossible de mettre en cache :', url, err)
          )
        )
      );
    }).then(() => {
      console.log('[SW] Installation terminée');
      return self.skipWaiting(); // Activation immédiate sans attendre la fermeture des onglets
    })
  );
});

// ── Activation : suppression des anciens caches ──
self.addEventListener('activate', event => {
  console.log('[SW] Activation…');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== FONT_CACHE_NAME)
          .map(name => {
            console.log('[SW] Suppression de l\'ancien cache :', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Service Worker actif — contrôle de tous les onglets');
      return self.clients.claim(); // Prend le contrôle immédiatement
    })
  );
});

// ── Fetch : stratégie Cache-First avec fallback réseau ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // Stratégie spéciale pour les polices Google Fonts : Network-First avec cache longue durée
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE_NAME).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => cached); // Si hors ligne, renvoie le cache existant
        })
      )
    );
    return;
  }

  // Stratégie Cache-First pour tout le reste
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // Ressource trouvée dans le cache — mise à jour en arrière-plan (Stale-While-Revalidate)
        const fetchPromise = fetch(request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, networkResponse.clone());
            });
          }
          return networkResponse;
        }).catch(() => {}); // Silencieux si hors ligne

        return cached; // Répond immédiatement avec le cache
      }

      // Ressource absente du cache — tentative réseau puis mise en cache
      return fetch(request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Hors ligne et ressource non cachée : page de fallback
        if (request.destination === 'document') {
          return caches.match('./index.html');
        }
        // Pour les autres ressources, on renvoie une réponse vide
        return new Response('', { status: 408, statusText: 'Hors ligne' });
      });
    })
  );
});

// ── Message : forcer la mise à jour depuis l'app ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
