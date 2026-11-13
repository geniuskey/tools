// 글자와 배경의 대비. WCAG 2.x 명암비가 기준이고, APCA(WCAG 3 초안)는 참고로 함께 낸다.
import { gamutMap, inGamut, oklch, fromOklch, rgb, round8, type Rgb } from './space';

const opaque = (c: Rgb) => (inGamut(c) ? c : gamutMap(c));

/** 위 색을 아래 색 위에 겹친 색 (아래는 불투명이라고 본다) */
export function composite(top: Rgb, below: Rgb): Rgb {
  const a = Math.max(0, Math.min(1, top.alpha));
  return rgb(top.r * a + below.r * (1 - a), top.g * a + below.g * (1 - a), top.b * a + below.b * (1 - a), 1);
}
const WHITE = rgb(1, 1, 1);

/** 실제로 화면에 보이는 두 색: 배경이 반투명이면 흰 바탕 위, 글자는 그 배경 위 */
export function visible(fg: Rgb, bg: Rgb): { fg: Rgb; bg: Rgb } {
  const b = composite(opaque(bg), WHITE);
  return { fg: composite(opaque(fg), b), bg: b };
}

/** 상대 휘도 (WCAG 2.x, sRGB) */
export function luminance(c: Rgb): number {
  const s = opaque(c);
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(s.r) + 0.7152 * lin(s.g) + 0.0722 * lin(s.b);
}

/** 명암비 1 ~ 21. 알파는 겹쳐서 계산한다 */
export function ratio(fg: Rgb, bg: Rgb): number {
  const v = visible(fg, bg);
  const [a, b] = [luminance(v.fg), luminance(v.bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** 화면에 적는 명암비. 반올림하면 4.499 가 4.5 로 보여 통과한 것처럼 보이므로 버린다 */
export const fmtRatio = (r: number) => (Math.floor(r * 100) / 100).toFixed(2);

export interface Level {
  id: 'aa' | 'aaa' | 'aa-large' | 'aaa-large' | 'ui';
  name: string;
  min: number;
  note: string;
}
export const LEVELS: Level[] = [
  { id: 'aa', name: 'AA 본문', min: 4.5, note: '보통 크기 글자 (1.4.3)' },
  { id: 'aaa', name: 'AAA 본문', min: 7, note: '보통 크기 글자 (1.4.6)' },
  { id: 'aa-large', name: 'AA 큰 글자', min: 3, note: '24px 이상, 굵으면 18.66px 이상' },
  { id: 'aaa-large', name: 'AAA 큰 글자', min: 4.5, note: '24px 이상, 굵으면 18.66px 이상' },
  { id: 'ui', name: '버튼 · 아이콘', min: 3, note: '테두리 · 아이콘 · 그래프 (1.4.11)' },
];

/**
 * APCA Lc (0.0.98G-4g, WCAG 3 초안). 양수는 밝은 배경의 어두운 글자, 음수는 그 반대.
 * 본문은 |Lc| 75 이상, 큰 글자 60, 굵은 큰 글자 · 아이콘 45 가 흔히 쓰는 기준.
 */
export function apca(text: Rgb, bg: Rgb): number {
  const v = visible(text, bg);
  const y = (c: Rgb) => {
    const Y = 0.2126729 * c.r ** 2.4 + 0.7151522 * c.g ** 2.4 + 0.072175 * c.b ** 2.4;
    return Y < 0.022 ? Y + (0.022 - Y) ** 1.414 : Y;
  };
  const yt = y(v.fg);
  const yb = y(v.bg);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) {
    const s = (yb ** 0.56 - yt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

export interface Suggestion {
  color: Rgb;
  ratio: number;
  /** OKLCH 밝기를 얼마나 옮겼나 (−1 ~ 1) */
  dl: number;
}

/**
 * 색상과 채도는 그대로 두고 밝기만 움직여, 목표 명암비를 넘는 가장 가까운 색을 찾는다. 어두운 쪽 · 밝은 쪽 따로.
 * role 이 'fg' 면 target 이 글자, 'bg' 면 배경. 결과는 8비트로 반올림한 뒤에도 기준을 넘는 색이다.
 */
export function suggest(target: Rgb, other: Rgb, min: number, role: 'fg' | 'bg'): { darker: Suggestion | null; lighter: Suggestion | null } {
  const base = oklch(opaque(target));
  const alpha = target.alpha;
  const make = (l: number) => round8(gamutMap(fromOklch(l, base.c, base.h, alpha)));
  const r = (c: Rgb) => (role === 'fg' ? ratio(c, other) : ratio(other, c));
  const search = (dir: -1 | 1): Suggestion | null => {
    const STEP = 0.004;
    let prev = base.l;
    for (let l = base.l; dir < 0 ? l >= -STEP / 2 : l <= 1 + STEP / 2; l += dir * STEP) {
      const lc = Math.max(0, Math.min(1, l));
      if (r(make(lc)) >= min) {
        // 지나친 곳과 바로 앞 사이를 좁힌다
        let [lo, hi] = [prev, lc];
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (r(make(mid)) >= min) hi = mid;
          else lo = mid;
        }
        const color = make(hi);
        return { color, ratio: r(color), dl: hi - base.l };
      }
      prev = lc;
    }
    return null;
  };
  return { darker: search(-1), lighter: search(1) };
}
