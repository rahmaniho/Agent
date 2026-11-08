/* sw.js — کش ساده برای کارکرد آفلاین پس از اولین بازدید */
const CACHE = "ecc-playbook-v1";
const ASSETS = [
  "./", "./index.html", "./assets/styles.css", "./assets/app.js",
  "./assets/data.json", "./assets/playbooks.json", "./assets/favicon.svg", "./assets/og.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  // داده‌ها: شبکه اول، کش پشتیبان
  if (/\/assets\/(data|playbooks)\.json$/.test(new URL(req.url).pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // بقیه: کش اول
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const clone = res.clone();
      caches.open(CACHE).then((c) => c.put(req, clone));
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
