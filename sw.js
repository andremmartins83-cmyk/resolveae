// Service worker do Resolve Aê
// Regra: guarda a casca do app para abrir offline, mas NUNCA guarda dado da planilha.
// Ao publicar mudanca no app, suba o numero da versao abaixo.
const VERSAO = 'resolveae-v12';
const CASCA = [
  './',
  './index.html',
  './financas.js',
  './manifest.webmanifest',
  './icone-192.png',
  './icone-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './CreatoDisplay-Regular.otf',
  './CreatoDisplay-Medium.otf',
  './CreatoDisplay-Black.otf'
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

// URL que carrega chave (?k=) ou aponta outra API (?api=) nunca vai para o cache
function temSegredo(url) {
  return url.searchParams.has('k') || url.searchParams.has('api') || url.searchParams.has('action');
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Chamadas a API (script.google.com ou servidor de teste) passam direto, sem cache.
  // Dado financeiro em cache viraria informacao velha exibida como atual.
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('action')) return;

  // Casca do app: tenta a rede primeiro para pegar atualizacao,
  // e cai para o cache quando estiver sem internet.
  e.respondWith(
    fetch(req)
      .then(resp => {
        // so guarda resposta boa, do proprio site, e sem segredo na URL
        if (resp && resp.ok && resp.type === 'basic' && !temSegredo(url)) {
          const copia = resp.clone();
          caches.open(VERSAO).then(c => c.put(req, copia)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
