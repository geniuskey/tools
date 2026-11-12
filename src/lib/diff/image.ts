// 픽셀 단위 이미지 비교. 사람 눈에 가까운 YIQ 색 공간에서 거리를 잰다.

export interface PixelDiff {
  /** 다른 픽셀 수 */
  count: number;
  /** 달라진 영역을 감싸는 상자 (없으면 null) */
  box: { x: number; y: number; w: number; h: number } | null;
}

const MAX_DELTA = 35215; // 흰색과 검은색 사이의 거리

// 투명도는 흰 바탕에 올린 것으로 보고 비교한다
const blend = (c: number, a: number) => 255 + ((c - 255) * a) / 255;

/**
 * 같은 크기의 RGBA 버퍼 둘을 비교한다. threshold 는 0(조금만 달라도) ~ 1(전혀 달라야).
 * out 을 주면 같은 곳은 흐린 회색조, 다른 곳은 강조색으로 칠한다.
 */
export function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, threshold: number, out?: Uint8ClampedArray): PixelDiff {
  const limit = MAX_DELTA * threshold * threshold;
  let count = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p += 4) {
      const aa = a[p + 3];
      const ba = b[p + 3];
      const r1 = blend(a[p], aa);
      const g1 = blend(a[p + 1], aa);
      const b1 = blend(a[p + 2], aa);
      let differs = false;
      if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2] || aa !== ba) {
        const dr = r1 - blend(b[p], ba);
        const dg = g1 - blend(b[p + 1], ba);
        const db = b1 - blend(b[p + 2], ba);
        const yy = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
        const ii = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
        const qq = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;
        differs = 0.5053 * yy * yy + 0.299 * ii * ii + 0.1957 * qq * qq > limit;
      }
      if (differs) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (out) {
          out[p] = 255;
          out[p + 1] = 0;
          out[p + 2] = 85;
          out[p + 3] = 255;
        }
      } else if (out) {
        const luma = r1 * 0.299 + g1 * 0.587 + b1 * 0.114;
        const v = 255 + (luma - 255) * 0.22;
        out[p] = out[p + 1] = out[p + 2] = v;
        out[p + 3] = 255;
      }
    }
  }
  return { count, box: count ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null };
}
