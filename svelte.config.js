import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    adapter: adapter({ strict: true, fallback: '404.html' }),
    // 모든 도구는 브라우저 안에서만 동작한다. 방문 통계(Google 태그 관리자 · 애널리틱스) 말고는 밖으로 나가는 요청을 막는다.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self', 'https://*.googletagmanager.com'],
        'style-src': ['self', 'unsafe-inline'],
        'font-src': ['self'],
        'img-src': ['self', 'data:', 'blob:', 'https://*.googletagmanager.com', 'https://*.google-analytics.com'],
        'media-src': ['self', 'blob:', 'mediastream:'],
        'connect-src': ['self', 'blob:', 'data:', 'https://*.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com'],
        'worker-src': ['self', 'blob:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
      },
    },
  },
};
