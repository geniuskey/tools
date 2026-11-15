import { tools } from '$lib/tools';

export const prerender = true;

export function GET() {
  const urls = ['/', ...tools.map((tool) => tool.href)];
  const entries = urls.map((path) => {
    const url = new URL(path, 'https://tools.euiyun.com').href;
    const escaped = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    return `  <url><loc>${escaped}</loc></url>`;
  });

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
