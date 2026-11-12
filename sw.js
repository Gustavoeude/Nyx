// Service worker: mantém os arquivos do player disponíveis offline.
const CACHE = "aplicativo-reprodutor-musica-v67";
const APP_CACHE_PREFIX = "aplicativo-reprodutor-musica-v";
const LEGACY_CACHE_NAMES = new Set(["musica-v26"]);
const CORE = [
  "./",
  "index.html",
  "style.css",
  "js/00-erros.js",
  "js/01-base.js",
  "js/02-player-nativo.js",
  "js/03-estado-cor-tema.js",
  "js/04-navegacao-dialogos.js",
  "js/05-importar.js",
  "js/06-playlists-listas.js",
  "js/07-reproducao.js",
  "js/08-progresso-player-completo.js",
  "js/09-ajustes.js",
  "js/10-fontes-letras.js",
  "js/pasta-monitorada.js",
  "js/12-onboarding.js",
  "js/13-fila-salva.js",
  "js/14-audio-extras.js",
  "js/15-idioma.js",
  "js/11-inicio-pwa.js",
  "jsmediatags.min.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => (key.startsWith(APP_CACHE_PREFIX) && key !== CACHE) || LEGACY_CACHE_NAMES.has(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  const appPaths = new Set(CORE.map(path => new URL(path, self.registration.scope).pathname));
  if (!appPaths.has(url.pathname)) {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith((async () => {
    const fromCache = async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") {
        return caches.match(new URL("index.html", self.registration.scope).href);
      }
      return null;
    };

    try {
      const response = await fetch(req);
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE);
          await cache.put(req, response.clone());
        } catch (_) {
          // Uma falha de cache não deve impedir a resposta online.
        }
        return response;
      }

      const cached = await fromCache();
      return cached || response;
    } catch (_) {
      const cached = await fromCache();
      return cached || new Response("Offline: este recurso ainda não está em cache.", {
        status: 504,
        statusText: "Gateway Timeout",
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
