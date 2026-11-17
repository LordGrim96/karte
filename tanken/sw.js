// Offline-Modus und schneller Start für das Tankbuch.
// - App-Dateien: sofort aus dem Speicher, im Hintergrund aktualisieren (neue Version beim nächsten Start)
// - Bibliotheken vom CDN (Karte, Texterkennung): feste Versionen, darum dauerhaft aus dem Speicher
// - Preise, Karten-Kacheln, Zwischendienst: immer direkt aus dem Netz (nicht hier zwischengespeichert)
const CACHE = 'tankbuch-v15';
const LIBS = 'tankbuch-libs-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== LIBS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // feste Bibliotheks-Versionen (z. B. leaflet@1.9.4, tesseract.js@5.1.1): einmal laden, dann aus dem Speicher
  if (url.hostname === 'cdn.jsdelivr.net' && /@\d+\.\d+\.\d+/.test(url.pathname)) {
    e.respondWith(caches.open(LIBS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'cors') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // eigene Dateien: sofort aus dem Speicher, parallel aus dem Netz auffrischen
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => c.match('./index.html'));
  }));
});
