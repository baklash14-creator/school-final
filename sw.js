// Service worker: makes the portals installable and lets pages open without a connection.
// Strategy: network first, fall back to the saved copy. Only this site's own files are saved;
// data from Supabase and every other website always goes straight to the network, so nothing private is stored here.
const CACHE = 'aiass-shell-v1';
const OFFLINE_FILES = ['login.html', 'css/app.css', 'css/auth.css', 'assets/favicon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE_FILES)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('login.html') : Response.error()))),
  );
});
