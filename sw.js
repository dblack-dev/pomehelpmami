/* น้องหมาช่วยแปลนิยาย — Service Worker
 * - App shell: precache แล้วใช้ cache-first / offline fallback
 * - CDN (Tailwind / Google Fonts): stale-while-revalidate
 * - Firebase / Google Auth / Firestore / Gemini APIs: ผ่านเน็ตตรง ๆ ไม่แคช
 */
const VERSION = 'v1.5.5';
const SHELL_CACHE = `pomehelpmami-shell-${VERSION}`;
const RUNTIME_CACHE = `pomehelpmami-runtime-${VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

const CDN_PRECACHE = [
  'https://cdn.tailwindcss.com'
];

const CDN_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_ASSETS);

    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.all(CDN_PRECACHE.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { mode: 'no-cors' }));
        await runtime.put(url, res);
      } catch (e) {}
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('pomehelpmami-') && !keep.has(k)).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never intercept Firebase / Google API / Identity / AI endpoints
  if (
    (url.hostname.includes('googleapis.com') && !CDN_HOSTS.has(url.hostname)) ||
    url.hostname.includes('firebase') ||
    (url.hostname.includes('gstatic.com') && !CDN_HOSTS.has(url.hostname)) ||
    url.hostname === 'accounts.google.com'
  ) {
    return;
  }

  // Page navigation: network-first with cached fallback for offline support
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && url.origin === self.location.origin) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        return cached || new Response('ออฟไลน์อยู่ และยังไม่มีข้อมูลในแคช', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // Same-origin assets: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return Response.error();
      }
    })());
    return;
  }

  // CDN assets: stale-while-revalidate
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
});
