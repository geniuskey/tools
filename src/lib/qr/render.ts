// QR 모듈을 SVG 로 그린다. 한 모듈이 1 단위.
import type { Qr } from './core';

export type Dots = 'square' | 'rounded' | 'dots';
export type Eyes = 'square' | 'rounded' | 'circle';

export interface Style {
  dots: Dots;
  eyes: Eyes;
  fg: string;
  bg: string;
  transparent: boolean;
  /** 여백 (모듈 수). 표준은 4 */
  margin: number;
  /** 가운데 로고 (data URL) 와 그 크기 비율 */
  logo: string;
  logoScale: number;
}

export const defaultStyle: Style = { dots: 'square', eyes: 'square', fg: '#111111', bg: '#ffffff', transparent: false, margin: 4, logo: '', logoScale: 0.22 };

const color = (c: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback);
const f = (n: number) => +n.toFixed(3);

/** 가운데 로고가 가리는 정사각형 (모듈 단위). 없으면 null. */
export function logoBox(qr: Qr, style: Style): { x: number; y: number; size: number } | null {
  if (!style.logo) return null;
  let size = Math.round(qr.size * Math.min(0.3, Math.max(0.1, style.logoScale)));
  if ((qr.size - size) % 2) size++;
  return { x: (qr.size - size) / 2, y: (qr.size - size) / 2, size };
}

export function renderSvg(qr: Qr, style: Style, pixels?: number): string {
  const n = qr.size;
  const m = Math.max(0, Math.min(10, Math.round(style.margin)));
  const total = n + m * 2;
  const fg = color(style.fg, '#111111');
  const bg = color(style.bg, '#ffffff');
  const box = logoBox(qr, style);
  const inEye = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const dark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= n || y >= n || !qr.modules[y * n + x] || inEye(x, y)) return false;
    return !(box && x >= box.x && x < box.x + box.size && y >= box.y && y < box.y + box.size);
  };

  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!dark(x, y)) continue;
      if (style.dots === 'dots') {
        d += `M${x + 0.05} ${y + 0.5}a.45 .45 0 1 0 .9 0a.45 .45 0 1 0 -.9 0z`;
      } else if (style.dots === 'rounded') {
        // 이웃이 없는 쪽 모서리만 둥글린다 → 이어진 모듈은 한 덩어리로 보인다
        const u = dark(x, y - 1);
        const r = dark(x + 1, y);
        const b = dark(x, y + 1);
        const l = dark(x - 1, y);
        const q = 0.5;
        const tl = !u && !l;
        const tr = !u && !r;
        const br = !b && !r;
        const bl = !b && !l;
        d += `M${x + (tl ? q : 0)} ${y}`;
        d += tr ? `H${x + 1 - q}a${q} ${q} 0 0 1 ${q} ${q}` : `H${x + 1}`;
        d += br ? `V${y + 1 - q}a${q} ${q} 0 0 1 -${q} ${q}` : `V${y + 1}`;
        d += bl ? `H${x + q}a${q} ${q} 0 0 1 -${q} -${q}` : `H${x}`;
        d += tl ? `V${y + q}a${q} ${q} 0 0 1 ${q} -${q}z` : 'z';
      } else {
        let w = 1;
        while (dark(x + w, y)) w++;
        d += `M${x} ${y}h${w}v1h-${w}z`;
        x += w - 1;
      }
    }
  }

  // 위치 찾기 무늬 (세 귀퉁이의 큰 네모)
  let eyes = '';
  for (const [ex, ey] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    if (style.eyes === 'circle') {
      eyes += `<path fill-rule="evenodd" d="M${ex} ${ey + 3.5}a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0zM${ex + 1} ${ey + 3.5}a2.5 2.5 0 1 1 5 0a2.5 2.5 0 1 1 -5 0z"/>`;
      eyes += `<circle cx="${ex + 3.5}" cy="${ey + 3.5}" r="1.5"/>`;
    } else {
      const ro = style.eyes === 'rounded' ? 2 : 0;
      const ri = style.eyes === 'rounded' ? 1.1 : 0;
      const rr = (x: number, y: number, s: number, r: number, cw: boolean) =>
        r
          ? cw
            ? `M${f(x + r)} ${y}h${f(s - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${f(s - 2 * r)}a${r} ${r} 0 0 1 -${r} ${r}h-${f(s - 2 * r)}a${r} ${r} 0 0 1 -${r} -${r}v-${f(s - 2 * r)}a${r} ${r} 0 0 1 ${r} -${r}z`
            : `M${f(x + r)} ${y}a${r} ${r} 0 0 0 -${r} ${r}v${f(s - 2 * r)}a${r} ${r} 0 0 0 ${r} ${r}h${f(s - 2 * r)}a${r} ${r} 0 0 0 ${r} -${r}v-${f(s - 2 * r)}a${r} ${r} 0 0 0 -${r} -${r}z`
          : cw
            ? `M${x} ${y}h${s}v${s}h-${s}z`
            : `M${x} ${y}v${s}h${s}v-${s}z`;
      eyes += `<path d="${rr(ex, ey, 7, ro, true)}${rr(ex + 1, ey + 1, 5, ri, false)}"/>`;
      eyes += `<path d="${rr(ex + 2, ey + 2, 3, style.eyes === 'rounded' ? 0.8 : 0, true)}"/>`;
    }
  }

  let logo = '';
  if (box) {
    const pad = 0.6;
    const src = style.logo.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    logo = `<image href="${src}" x="${box.x + pad}" y="${box.y + pad}" width="${box.size - pad * 2}" height="${box.size - pad * 2}" preserveAspectRatio="xMidYMid meet"/>`;
  }

  const sizeAttr = pixels ? ` width="${pixels}" height="${pixels}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-m} ${-m} ${total} ${total}"${sizeAttr} shape-rendering="${style.dots === 'square' && style.eyes === 'square' ? 'crispEdges' : 'geometricPrecision'}">` +
    (style.transparent ? '' : `<rect x="${-m}" y="${-m}" width="${total}" height="${total}" fill="${bg}"/>`) +
    `<g fill="${fg}"><path d="${d}"/>${eyes}</g>${logo}</svg>`
  );
}

/** 두 색의 명암비 (WCAG). 1 ~ 21 */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const isDarker = (a: string, b: string) => contrast(a, '#ffffff') > contrast(b, '#ffffff');
