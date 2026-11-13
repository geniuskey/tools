// 색각 이상으로 보이는 색 흉내. Machado, Oliveira, Fernandes (2009) "A Physiologically-based Model for
// Simulation of Color Vision Deficiency" 의 심도 1.0 행렬을 선형 sRGB 에 곱한다. 전색맹은 휘도만 남긴다.
import { clip, fromLinRgb, gamutMap, inGamut, linRgb, type Rgb, type Vec } from './space';

export type Cvd = 'none' | 'protan' | 'deutan' | 'tritan' | 'achroma';
export const CVDS: [Cvd, string, string][] = [
  ['none', '그대로', ''],
  ['protan', '적색맹', '빨강을 못 느낌 · 남성 약 1%'],
  ['deutan', '녹색맹', '초록을 못 느낌 · 남성 약 1%, 약한 녹색약까지 약 6%'],
  ['tritan', '청색맹', '파랑을 못 느낌 · 아주 드묾'],
  ['achroma', '전색맹', '밝기만 보임'],
];

const M: Record<'protan' | 'deutan' | 'tritan', number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function simulate(c: Rgb, kind: Cvd): Rgb {
  if (kind === 'none') return c;
  const v = linRgb(inGamut(c) ? c : gamutMap(c));
  if (kind === 'achroma') {
    const y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    return clip(fromLinRgb([y, y, y], c.alpha));
  }
  const m = M[kind];
  const out: Vec = [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as Vec;
  return clip(fromLinRgb(out, c.alpha));
}

/** SVG feColorMatrix 에 넣을 값 (선형 RGB 로 계산하도록 color-interpolation-filters="linearRGB" 와 함께 쓴다) */
export function svgMatrix(kind: Exclude<Cvd, 'none'>): string {
  const m = kind === 'achroma' ? [[0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722]] : M[kind];
  return m.map((r) => `${r.join(' ')} 0 0`).join(' ') + ' 0 0 0 1 0';
}
