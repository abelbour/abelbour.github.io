/* Cochera PWA — cachea solo assets del mismo origen; la API del equipo siempre va a red. */
/* IMPORTANTE: subir la versión de CACHE en cada cambio de web/ (si no, el
   navegador sigue sirviendo los archivos viejos y parece que "no cambió nada"). */
const CACHE = "cochera-v28";
const ASSETS = ["./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return; // API del equipo: siempre red
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
