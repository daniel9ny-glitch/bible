/* 늘뷰어 서비스 워커: 앱 틀과 라이브러리를 저장해 오프라인에서도 열리게 합니다. */
const VERSION = 'neulviewer-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'];
const CACHEABLE_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(async (u) => { const r = await fetch(u); if (r.ok) await cache.put(u, r); }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const fd = await req.formData();
        const cache = await caches.open('neul-share');
        let n = 0;
        for (const f of fd.getAll('pdfs')) {
          if (!f || !f.name) continue;
          await cache.put('./shared/' + (n++) + '-' + Date.now(), new Response(f, { headers: { 'x-name': encodeURIComponent(f.name), 'content-type': f.type || 'application/pdf' } }));
        }
      } catch (_) {}
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && !CACHEABLE_HOSTS.includes(url.hostname)) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { const r = await fetch(req); const c = await caches.open(VERSION); c.put('./index.html', r.clone()); return r; }
      catch (_) { return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    /* 한글 편집기의 큰 정적 파일(WASM·폰트)은 한 번 받으면 다시 받지 않는다 (VERSION을 올리면 갱신) */
    if (hit && same && url.pathname.includes('/hwp/') && /\.(wasm|ttf|woff2?)$/i.test(url.pathname)) return hit;
    const net = fetch(req).then((r) => { if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
