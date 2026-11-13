// 한 색으로 밝기 단계(50 ~ 950)와 어울리는 색을 만든다. 모두 OKLCH 에서 계산해 단계마다 밝기 차이가 눈에 고르게 보인다.
import { fmtNum, fmtOklch, toHex } from './format';
import { fromOklab, fromOklch, gamutMap, normHue, oklab, oklch, rgb, round8, type Rgb } from './space';

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
// 단계마다 기본 밝기와 채도 비율. 널리 쓰는 UI 팔레트(Tailwind v4)의 OKLCH 값을 고르게 다듬은 것
const L = [0.971, 0.936, 0.885, 0.808, 0.707, 0.623, 0.546, 0.488, 0.424, 0.379, 0.282];
const C = [0.07, 0.15, 0.27, 0.45, 0.75, 1, 1, 0.9, 0.75, 0.58, 0.42];

export interface Swatch {
  step: number;
  color: Rgb;
  hex: string;
  /** 기준 색이 이 단계에 그대로 들어갔다 */
  base: boolean;
}

/** 기준 색과 밝기가 가장 가까운 단계를 기준 색 그대로 두고, 나머지 단계를 양 끝까지 고르게 늘인다 */
export function scale(baseColor: Rgb): Swatch[] {
  const b = oklch({ ...baseColor, alpha: 1 });
  let k = 0;
  for (let i = 1; i < L.length; i++) if (Math.abs(L[i] - b.l) < Math.abs(L[k] - b.l)) k = i;
  // 아주 밝거나 어두운 색이면 끝 단계 자체가 기준 색이다
  const top = Math.max(L[0], b.l);
  const bottom = Math.min(L[L.length - 1], b.l);
  return STEPS.map((step, i) => {
    if (i === k) {
      const color = round8(gamutMap({ ...baseColor, alpha: 1 }));
      return { step, color, hex: toHex(color), base: true };
    }
    let l: number;
    if (i < k) l = top + ((L[i] - L[0]) * (b.l - top)) / (L[k] - L[0] || 1);
    else l = bottom + ((L[i] - L[L.length - 1]) * (b.l - bottom)) / (L[k] - L[L.length - 1] || 1);
    // 옅은 색에서 시작해도 가운데 단계가 지나치게 진해지지 않게 묶는다
    const c = b.c * Math.min(C[i] / C[k], 2.5);
    const color = round8(gamutMap(fromOklch(l, c, b.h)));
    return { step, color, hex: toHex(color), base: false };
  });
}

export type Harmony = 'complement' | 'analogous' | 'triad' | 'split' | 'square';
export const HARMONIES: [Harmony, string, number[]][] = [
  ['complement', '보색', [0, 180]],
  ['analogous', '유사색', [-30, 0, 30]],
  ['triad', '삼각', [0, 120, 240]],
  ['split', '보색 양옆', [0, 150, 210]],
  ['square', '사각', [0, 90, 180, 270]],
];
/** 밝기와 채도는 두고 색상각만 돌린다 */
export function harmony(base: Rgb, angles: number[]): Rgb[] {
  const b = oklch({ ...base, alpha: 1 });
  return angles.map((a) => (a === 0 ? round8(gamutMap({ ...base, alpha: 1 })) : round8(gamutMap(fromOklch(b.l, b.c, normHue(b.h + a))))));
}

export type ExportKind = 'css' | 'css-oklch' | 'tailwind3' | 'tailwind4' | 'json' | 'scss';
export const EXPORTS: [ExportKind, string][] = [
  ['css', 'CSS 변수'],
  ['css-oklch', 'CSS 변수 (OKLCH)'],
  ['tailwind4', 'Tailwind v4'],
  ['tailwind3', 'Tailwind v3'],
  ['scss', 'SCSS'],
  ['json', 'JSON'],
];

/** 이름을 CSS 변수에 쓸 수 있게 다듬는다 */
export function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'brand'
  );
}

export function exportScale(name: string, swatches: Swatch[], kind: ExportKind): string {
  const n = slug(name);
  const ok = (c: Rgb) => fmtOklch(c);
  switch (kind) {
    case 'css':
      return `:root {\n${swatches.map((s) => `  --${n}-${s.step}: ${s.hex};`).join('\n')}\n}`;
    case 'css-oklch':
      return `:root {\n${swatches.map((s) => `  --${n}-${s.step}: ${ok(s.color)};`).join('\n')}\n}`;
    case 'tailwind4':
      return `@theme {\n${swatches.map((s) => `  --color-${n}-${s.step}: ${ok(s.color)};`).join('\n')}\n}`;
    case 'tailwind3': {
      const key = /^[a-z_$][\w$]*$/i.test(n) ? n : `'${n}'`;
      return `// tailwind.config.js 의 theme.extend.colors\n${key}: {\n${swatches.map((s) => `  ${s.step}: '${s.hex}',`).join('\n')}\n},`;
    }
    case 'scss':
      return swatches.map((s) => `$${n}-${s.step}: ${s.hex};`).join('\n');
    case 'json':
      return JSON.stringify({ [n]: Object.fromEntries(swatches.map((s) => [s.step, s.hex])) }, null, 2);
  }
}

// ── 사진의 주요 색 ──
export interface Dominant {
  color: Rgb;
  hex: string;
  /** 사진에서 차지하는 비율 0 ~ 1 */
  share: number;
}

/**
 * RGBA 픽셀에서 많이 쓰인 색 k 개를 뽑는다. OKLab 에서 k-평균 (시작점은 k-means++ 를 흉내 낸 고정 순서라 결과가 매번 같다).
 * 투명한 픽셀은 건너뛴다.
 */
export function dominant(data: Uint8ClampedArray | Uint8Array, k = 6, maxSamples = 6000): Dominant[] {
  const total = data.length / 4;
  const every = Math.max(1, Math.floor(total / maxSamples));
  const pts: [number, number, number][] = [];
  for (let i = 0; i < total; i += every) {
    if (data[i * 4 + 3] < 128) continue;
    pts.push(oklab(rgb(data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255)));
  }
  if (!pts.length) return [];
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // 시작점: 첫 점, 그다음은 이미 고른 점들에서 가장 먼 점
  const centers: number[][] = [pts[0].slice()];
  const near = pts.map((p) => d2(p, pts[0]));
  while (centers.length < k) {
    let far = 0;
    for (let i = 1; i < pts.length; i++) if (near[i] > near[far]) far = i;
    if (near[far] < 1e-6) break;
    centers.push(pts[far].slice());
    for (let i = 0; i < pts.length; i++) near[i] = Math.min(near[i], d2(pts[i], pts[far]));
  }
  const owner = new Int32Array(pts.length);
  for (let iter = 0; iter < 16; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      let best = 0;
      for (let j = 1; j < centers.length; j++) if (d2(pts[i], centers[j]) < d2(pts[i], centers[best])) best = j;
      if (owner[i] !== best) [owner[i], moved] = [best, true];
    }
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const s = sum[owner[i]];
      s[0] += pts[i][0];
      s[1] += pts[i][1];
      s[2] += pts[i][2];
      s[3]++;
    }
    centers.forEach((c, j) => {
      const [x, y, z, n] = sum[j];
      if (n) [c[0], c[1], c[2]] = [x / n, y / n, z / n];
    });
    if (!moved && iter) break;
  }
  const count = centers.map(() => 0);
  for (let i = 0; i < pts.length; i++) count[owner[i]]++;
  return centers
    .map((c, j) => {
      const color = round8(gamutMap(fromOklab3(c)));
      return { color, hex: toHex(color), share: count[j] / pts.length };
    })
    .filter((d) => d.share > 0)
    .sort((a, b) => b.share - a.share);
}
const fromOklab3 = (c: number[]) => fromOklab([c[0], c[1], c[2]]);

/** 비율을 "38%" 로 */
export const fmtShare = (v: number) => `${fmtNum(v * 100, 0)}%`;
