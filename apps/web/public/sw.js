// Service worker do SyncTasks: guarda a casca do app para abrir rápido e instalar como PWA.
// Dados (/api) nunca são guardados em cache: as ações sempre exigem conexão.
const CACHE = 'synctasks-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    // Rede primeiro; sem rede, a última versão da página.
    event.respondWith(fetch(event.request).catch(() => caches.match('/')));
    return;
  }
  // Arquivos estáticos (com hash no nome): cache primeiro.
  event.respondWith(
    caches.match(event.request).then(
      (hit) => hit || fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      }),
    ),
  );
});

// Item 119: avisos no aparelho (notificações do navegador). Tocar no aviso abre a tarefa no SyncTasks.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'SyncTasks', {
      body: data.body || 'Você tem um aviso novo.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/#/avisos' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) return open.navigate(url).then((c) => (c || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
