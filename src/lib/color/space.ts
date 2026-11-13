// 색 공간 사이 변환. 기본 표현은 sRGB(감마 적용) 0~1 실수이고, 넓은 색역에서 들어온 색은 0~1 밖으로 나갈 수 있다.
// 행렬과 공식은 CSS Color 4 명세의 예시 코드와 같은 값을 쓴다. OKLab 은 Björn Ottosson 의 원래 행렬.

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0 ~ 1 */
  alpha: number;
}
export type Vec = [number, number, number];

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const mul = (m: number[][], v: Vec): Vec => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
const hueOf = (a: number, b: number) => {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
};
export const normHue = (h: number) => ((h % 360) + 360) % 360;
const rad = (h: number) => (h * Math.PI) / 180;

export const rgb = (r: number, g: number, b: number, alpha = 1): Rgb => ({ r, g, b, alpha });

// ── sRGB 감마 ──
export function toLinear(c: number): number {
  const a = Math.abs(c);
  return a <= 0.04045 ? c / 12.92 : Math.sign(c) * ((a + 0.055) / 1.055) ** 2.4;
}
export function fromLinear(c: number): number {
  const a = Math.abs(c);
  return a <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * a ** (1 / 2.4) - 0.055);
}
export const linRgb = (c: Rgb): Vec => [toLinear(c.r), toLinear(c.g), toLinear(c.b)];
export const fromLinRgb = (v: Vec, alpha = 1): Rgb => rgb(fromLinear(v[0]), fromLinear(v[1]), fromLinear(v[2]), alpha);

// ── XYZ ──
const SRGB_TO_XYZ = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_TO_SRGB = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const P3_TO_XYZ = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const XYZ_TO_P3 = [
  [2.493496911941425, -0.9313836179191239, -0.40271078445071684],
  [-0.8294889695615747, 1.7626640603183463, 0.023624685841943577],
  [0.03584583024378447, -0.07617238926804182, 0.9568845240076872],
];
const D65_TO_D50 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
];
const D50_TO_D65 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];
const D50: Vec = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

export const xyz65 = (c: Rgb): Vec => mul(SRGB_TO_XYZ, linRgb(c));
export const fromXyz65 = (v: Vec, alpha = 1): Rgb => fromLinRgb(mul(XYZ_TO_SRGB, v), alpha);
export const xyz50 = (c: Rgb): Vec => mul(D65_TO_D50, xyz65(c));
export const fromXyz50 = (v: Vec, alpha = 1): Rgb => fromXyz65(mul(D50_TO_D65, v), alpha);

// ── display-p3 (감마는 sRGB 와 같다) ──
export function p3(c: Rgb): Vec {
  const v = mul(XYZ_TO_P3, xyz65(c));
  return [fromLinear(v[0]), fromLinear(v[1]), fromLinear(v[2])];
}
export function fromP3(v: Vec, alpha = 1): Rgb {
  return fromXyz65(mul(P3_TO_XYZ, [toLinear(v[0]), toLinear(v[1]), toLinear(v[2])]), alpha);
}

// ── OKLab · OKLCH ──
export function oklab(c: Rgb): Vec {
  const [r, g, b] = linRgb(c);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function fromOklab(v: Vec, alpha = 1): Rgb {
  const [L, a, b] = v;
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return fromLinRgb([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s], alpha);
}
export function oklch(c: Rgb): Oklch {
  const [l, a, b] = oklab(c);
  const ch = Math.hypot(a, b);
  // 채도가 거의 없으면 색상각은 의미가 없다
  return ch < 1e-4 ? { l, c: 0, h: 0 } : { l, c: ch, h: hueOf(a, b) };
}
export const fromOklch = (l: number, c: number, h: number, alpha = 1): Rgb => fromOklab([l, c * Math.cos(rad(h)), c * Math.sin(rad(h))], alpha);

// ── CIE Lab · LCH (D50, CSS 와 같다) ──
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;
export function lab(c: Rgb): Vec {
  const v = xyz50(c).map((x, i) => x / D50[i]);
  const f = v.map((x) => (x > EPS ? Math.cbrt(x) : (KAPPA * x + 16) / 116));
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
export function fromLab(v: Vec, alpha = 1): Rgb {
  const [L, a, b] = v;
  const f1 = (L + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const x = f0 ** 3 > EPS ? f0 ** 3 : (116 * f0 - 16) / KAPPA;
  const y = L > KAPPA * EPS ? ((L + 16) / 116) ** 3 : L / KAPPA;
  const z = f2 ** 3 > EPS ? f2 ** 3 : (116 * f2 - 16) / KAPPA;
  return fromXyz50([x * D50[0], y * D50[1], z * D50[2]], alpha);
}
export function lch(c: Rgb): Vec {
  const [l, a, b] = lab(c);
  const ch = Math.hypot(a, b);
  return [l, ch, ch < 0.0015 ? 0 : hueOf(a, b)];
}
export const fromLch = (l: number, c: number, h: number, alpha = 1): Rgb => fromLab([l, c * Math.cos(rad(h)), c * Math.sin(rad(h))], alpha);

// ── HSL · HWB (sRGB 안의 색에만 의미가 있다) ──
/** h 0~360, s · l 0~100 */
export function hsl(c: Rgb): Vec {
  const { r, g, b } = c;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d > 1e-9) {
    s = l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [normHue(h), s * 100, l * 100];
}
export function fromHsl(h: number, s: number, l: number, alpha = 1): Rgb {
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  h = normHue(h);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return rgb(f(0), f(8), f(4), alpha);
}
/** h 0~360, w · b 0~100 */
export function hwb(c: Rgb): Vec {
  return [hsl(c)[0], Math.min(c.r, c.g, c.b) * 100, (1 - Math.max(c.r, c.g, c.b)) * 100];
}
export function fromHwb(h: number, w: number, bl: number, alpha = 1): Rgb {
  w = Math.max(0, w) / 100;
  bl = Math.max(0, bl) / 100;
  if (w + bl >= 1) {
    const g = w / (w + bl);
    return rgb(g, g, g, alpha);
  }
  const base = fromHsl(h, 100, 50);
  const k = 1 - w - bl;
  return rgb(base.r * k + w, base.g * k + w, base.b * k + w, alpha);
}

// ── CMYK: 색 관리 없이 단순 계산한 값 (인쇄소 값과는 다르다) ──
/** 0~100 */
export function cmyk(c: Rgb): [number, number, number, number] {
  const k = 1 - Math.max(c.r, c.g, c.b);
  if (k >= 1 - 1e-9) return [0, 0, 0, 100];
  return [((1 - c.r - k) / (1 - k)) * 100, ((1 - c.g - k) / (1 - k)) * 100, ((1 - c.b - k) / (1 - k)) * 100, k * 100];
}
export function fromCmyk(c: number, m: number, y: number, k: number, alpha = 1): Rgb {
  const [C, M, Y, K] = [c, m, y, k].map((v) => Math.max(0, Math.min(100, v)) / 100);
  return rgb((1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K), alpha);
}

// ── 색역 ──
export function inGamut(c: Rgb, eps = 1e-5): boolean {
  return [c.r, c.g, c.b].every((v) => v >= -eps && v <= 1 + eps);
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const clip = (c: Rgb): Rgb => rgb(clamp01(c.r), clamp01(c.g), clamp01(c.b), clamp01(c.alpha));

export function deltaEOK(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * sRGB 밖의 색을 안으로 들인다 (CSS Color 4 의 색역 맞춤).
 * 밝기와 색상은 두고 OKLCH 채도만 줄이다가, 잘라낸 색과 눈으로 구별되지 않을 만큼(ΔE OK 0.02) 가까워지면 그 색을 쓴다.
 */
export function gamutMap(c: Rgb): Rgb {
  if (inGamut(c)) return clip(c);
  const { l, c: chroma, h } = oklch(c);
  if (l >= 1) return rgb(1, 1, 1, clamp01(c.alpha));
  if (l <= 0) return rgb(0, 0, 0, clamp01(c.alpha));
  const JND = 0.02;
  const E = 0.0001;
  let clipped = clip(c);
  if (deltaEOK(clipped, c) < JND) return clipped;
  let min = 0;
  let max = chroma;
  let minInGamut = true;
  while (max - min > E) {
    const mid = (min + max) / 2;
    const cur = fromOklch(l, mid, h, c.alpha);
    if (minInGamut && inGamut(cur)) {
      min = mid;
      continue;
    }
    clipped = clip(cur);
    const e = deltaEOK(clipped, cur);
    if (e < JND) {
      if (JND - e < E) return clipped;
      minInGamut = false;
      min = mid;
    } else max = mid;
  }
  return clipped;
}

/** 8비트로 반올림한 색 (HEX 로 적었다 다시 읽은 것과 같다) */
export function round8(c: Rgb): Rgb {
  const q = (v: number) => Math.round(clamp01(v) * 255) / 255;
  return rgb(q(c.r), q(c.g), q(c.b), Math.round(clamp01(c.alpha) * 255) / 255);
}
