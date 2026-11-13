/* Static application cache. API calls and user data are never cached. */
const CACHE = 'agent-studio-v15';
const ASSETS = [
  './', './index.html', './assets/styles.css', './assets/studio.css', './assets/refinement.css', './assets/app.js', './assets/lazy.js',
  './assets/entry.css', './assets/neural-auth.css', './assets/neural-core.jpg', './assets/studio-illustration.png', './assets/workspace.js', './assets/agent.js', './assets/data.json', './assets/playbooks.json',
  './assets/favicon.svg', './assets/brand-logo.jpg', './assets/brand-icon-48.png', './assets/brand-icon-180.png', './assets/brand-icon-192.png', './assets/brand-icon-512.png', './assets/brand-icon-maskable-512.png', './assets/og.svg', './assets/fonts/vazirmatn-arabic-wght-normal.woff2', './assets/fonts/vazirmatn-latin-wght-normal.woff2', './manifest.webmanifest',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(ASSETS.map(path => cache.add(path)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('agent-studio-') || key.startsWith('ecc-playbook-')) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  if (req.mode === 'navigate' || /\/(data|playbooks)\.json$/.test(url.pathname)) {
    event.respondWith(fetch(req).then(res => {
      if (res.ok && req.mode !== 'navigate') { const copy = res.clone(); caches.open(CACHE).then(cache => cache.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(cache => cache.put(req, copy)); }
    return res;
  })));
});
