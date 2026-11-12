import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    adapter: adapter({ strict: true, fallback: '404.html' }),
    // 모든 도구는 브라우저 안에서만 동작한다. 밖으로 나가는 요청 자체를 막는다.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'font-src': ['self'],
        'img-src': ['self', 'data:', 'blob:'],
        'media-src': ['self', 'blob:', 'mediastream:'],
        'connect-src': ['self', 'blob:', 'data:'],
        'worker-src': ['self', 'blob:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
      },
    },
  },
};
