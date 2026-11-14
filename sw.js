/* ==========================================================================
   iPad POS — Service Worker
   Strategy: Network-First with Cache Fallback (+ timeout) for everything GET.
   - Online  → always fetch the newest files from GitHub Pages (cache is refreshed)
   - Offline → serve the last cached copy, so the POS works 100% offline
   localStorage / IndexedDB are never touched by this file.
   ========================================================================== */

const SW_VERSION = '1.0.2';
const CACHE_PREFIX = 'ipad-pos-';
const CACHE_NAME = `${CACHE_PREFIX}${SW_VERSION}`;
const NETWORK_TIMEOUT_MS = 4000;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/logo-mascot.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Chonburi&family=Prompt:wght@300;400;500;600;700&display=swap',
  'https://cdn.tailwindcss.com',
];

// Never intercept the Google Sheets sync endpoint
const BYPASS_HOSTS = ['script.google.com', 'script.googleusercontent.com'];

/* ---------- precache ---------- */
async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled([
    ...APP_SHELL.map(async (url) => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      await cache.put(url, await cleanResponse(res));
    }),
    ...EXTERNAL_ASSETS.map(async (url) => {
      const res = await fetch(new Request(url, { mode: 'no-cors' }));
      await cache.put(url, res);
    }),
  ]);
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) console.warn('[SW] precache partial failure', failed.map((f) => String(f.reason)));
  return { ok: failed.length === 0, failed: failed.length };
}

/* Safari refuses redirected responses for navigations → rebuild them */
async function cleanResponse(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().finally(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) { /* ignore */ }
    }
    await self.clients.claim();
  })());
});

/* ---------- fetch: network-first ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;
  if (BYPASS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return;
  event.respondWith(networkFirst(event, req, url));
});

async function matchCache(req, isNav) {
  const cache = await caches.open(CACHE_NAME);
  let res = await cache.match(req, { ignoreVary: true });
  if (!res) res = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
  if (!res && isNav) res = (await cache.match('./index.html')) || (await cache.match('./'));
  return res;
}

async function networkFirst(event, req, url) {
  const isNav = req.mode === 'navigate';
  const sameOrigin = url.origin === self.location.origin;

  const network = (async () => {
    // same-origin: revalidate with the server so a new GitHub Pages commit is picked up immediately
    let res = (isNav || sameOrigin)
      ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      : await fetch(req);
    if (isNav) res = await cleanResponse(res);
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {}));
    }
    return res;
  })();
  network.catch(() => {}); // avoid unhandled rejection when the timeout wins

  const timeout = new Promise((resolve) => setTimeout(() => resolve('__timeout__'), NETWORK_TIMEOUT_MS));

  try {
    const first = await Promise.race([network, timeout]);
    if (first !== '__timeout__') {
      if (first.ok || first.type === 'opaque') return first;
      const cached = await matchCache(req, isNav); // server error → prefer cached copy
      return cached || first;
    }
    const cached = await matchCache(req, isNav); // slow network → use cache now
    if (cached) return cached;
    return await network;
  } catch (err) {
    const cached = await matchCache(req, isNav);
    if (cached) return cached;
    if (isNav) {
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#f7f0dd;color:#2b1e1c;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#862d28">ออฟไลน์</h1><p>กรุณาเปิดแอปขณะออนไลน์อย่างน้อย 1 ครั้งเพื่อติดตั้งไฟล์สำหรับใช้งานออฟไลน์</p></div>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    return Response.error();
  }
}

/* ---------- messages from the page ---------- */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  const reply = (msg) => { if (event.ports && event.ports[0]) event.ports[0].postMessage(msg); };

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    reply({ ok: true });
  } else if (data.type === 'REFRESH_CACHE') {
    // Re-download every shell file; only overwrites cache entries that downloaded successfully
    event.waitUntil(precache().then(reply).catch((e) => reply({ ok: false, error: String(e) })));
  } else if (data.type === 'GET_VERSION') {
    reply({ version: SW_VERSION });
  }
});
