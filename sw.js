// Service worker do Resolve Aê
// Regra: guarda a casca do app para abrir offline, mas NUNCA guarda dado da planilha.
// Ao publicar mudanca no app, suba o numero da versao abaixo.
const VERSAO = 'resolveae-v4';
const CASCA = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icone-192.png',
  './icone-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSAO).then(c => c.addAll(CASCA)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n !== VERSAO).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Chamadas a API (script.google.com) passam direto, sem cache.
  // Dado financeiro em cache viraria informacao velha exibida como atual.
  if (url.origin !== self.location.origin) return;

  // Casca do app: tenta a rede primeiro para pegar atualizacao,
  // e cai para o cache quando estiver sem internet.
  e.respondWith(
    fetch(req)
      .then(resp => {
        const copia = resp.clone();
        caches.open(VERSAO).then(c => c.put(req, copia)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
