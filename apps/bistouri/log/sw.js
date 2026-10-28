// Service worker: keeps the app shell (HTML, CSS, JS, icons and the pinned
// supabase-js build) so the logger opens with no signal. Cases and program lists
// live in IndexedDB (js/store.js), not here. Supabase API calls are never cached.
//
// VERSION is replaced with the git commit by scripts/deploy_log.sh, so every
// deploy installs a fresh cache and removes the old one.
const VERSION = 'd7cce02';
const CACHE = `bistouri-log-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'js/app.js',
  'js/data.js',
  'js/store.js',
  'js/ref.js',
  'js/export.js',
  'js/ui.js',
  'js/views/signin.js',
  'js/views/onboarding.js',
  'js/views/cases.js',
  'js/views/caseForm.js',
  'js/views/progress.js',
  'js/views/achievements.js',
  'js/views/settings.js',
  'shared/config.js',
  'shared/util.js',
  'shared/achievementEngine.js',
  'shared/achievementCatalogue.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js',
];

// On localhost the network comes first so edits show up on reload; the cache is
// only a fallback. Deployed, the cache comes first and refreshes in the background.
const DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bistouri-log-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isLibrary = url.hostname === 'cdn.jsdelivr.net';
  if (!sameOrigin && !isLibrary) return; // Supabase and anything else: straight to the network

  // Any page inside the app (e.g. ./#/case/new, ./index.html?x) is the one shell page.
  const key = req.mode === 'navigate' ? new URL('./', self.registration.scope).href : req;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const fromNetwork = fetch(req).then((res) => {
      if (res.ok && (sameOrigin || res.type === 'cors')) cache.put(key, res.clone());
      return res;
    });
    if (DEV) return fromNetwork.catch(() => cached || Response.error());
    if (cached) {
      event.waitUntil(fromNetwork.catch(() => null));
      return cached;
    }
    return fromNetwork;
  })());
});
