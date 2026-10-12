'use strict';
// Public fallback only. App pages, API, characters and campaign data are NEVER cached.
const VERSION = '0.17.7';
const CACHE_PREFIX = 'nightcity-public-shell-';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const PUBLIC_ASSETS = ['/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'];
const PUBLIC_PATHS = new Set(PUBLIC_ASSETS);

async function publicResponse(path) {
  const response = await fetch(path, {cache: 'reload', credentials: 'same-origin', redirect: 'error'});
  if (!response.ok || response.type === 'opaque') throw new Error('Public asset unavailable');
  const mime = (response.headers.get('content-type') || '').toLowerCase();
  // A hosting sign-in page must never be mistaken for our offline document.
  if (path === '/offline.html') {
    if (!mime.includes('text/html') || !(await response.clone().text()).includes('name="night-city-offline-shell"')) throw new Error('Unexpected offline response');
  } else if (path === '/manifest.webmanifest') {
    const manifest = await response.clone().json();
    if (manifest.name !== 'Night City Crew' || !Array.isArray(manifest.icons)) throw new Error('Unexpected manifest');
  } else if (!mime.includes('image/png')) throw new Error('Unexpected icon');
  return response;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const path of PUBLIC_ASSETS) await cache.put(path, await publicResponse(path));
    // New versions wait until the player explicitly requests activation.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match('/offline.html')) || new Response('Нет связи с сервером. Восстанови сеть и обнови страницу.', {status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
    }));
    return;
  }
  if (!PUBLIC_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(url.pathname)) || publicResponse(url.pathname);
  })());
});
