/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
// 한 번 열면 오프라인에서도 동작한다. 빌드 산출물만 캐시한다.
import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `tools-${version}`;
// _headers · _redirects 는 Cloudflare Pages 설정 파일이라 배포본에서는 내려받을 수 없다 (404). 캐시 목록에서 뺀다.
const ASSETS = [...build, ...files.filter((f) => !/^\/_(headers|redirects)$/.test(f)), ...prerendered];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // 해시가 붙은 정적 자산은 캐시 우선
      if (build.includes(url.pathname) || files.includes(url.pathname)) {
        const hit = await cache.match(url.pathname);
        if (hit) return hit;
      }
      try {
        const res = await fetch(req);
        return res;
      } catch (err) {
        const hit =
          (await cache.match(req)) ||
          (await cache.match(url.pathname)) ||
          (await cache.match(url.pathname.replace(/\/$/, '') + '.html'));
        if (hit) return hit;
        throw err;
      }
    })(),
  );
});
