// 바탕 이미지(픽셀)를 다루는 함수들. 모두 새 캔버스를 돌려주고 원본은 건드리지 않는다
// (실행 취소 기록이 예전 캔버스를 그대로 참조하기 때문).
import type { Rect } from './shapes';

export interface Adjust {
  brightness: number; // -100 ~ 100
  contrast: number;
  saturation: number;
  gray: boolean;
  invert: boolean;
}

export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, gray: false, invert: false };

export const isNeutral = (a: Adjust) => a.brightness === 0 && a.contrast === 0 && a.saturation === 0 && !a.gray && !a.invert;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export async function canvasFromBlob(blob: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // SVG 등 createImageBitmap 이 못 읽는 형식
    bmp = await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('이미지를 읽을 수 없습니다'));
      };
      img.src = url;
    });
  }
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth || 1024 : bmp.width;
  const h = 'naturalHeight' in bmp ? bmp.naturalHeight || 768 : bmp.height;
  const c = makeCanvas(w, h);
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  if ('close' in bmp) bmp.close();
  return c;
}

export function blankCanvas(w: number, h: number, color: string | null): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  if (color) {
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

export function cropCanvas(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const c = makeCanvas(r.w, r.h);
  c.getContext('2d')!.drawImage(src, -Math.round(r.x), -Math.round(r.y));
  return c;
}

export function rotateCanvas(src: HTMLCanvasElement, dir: 'cw' | 'ccw'): HTMLCanvasElement {
  const c = makeCanvas(src.height, src.width);
  const g = c.getContext('2d')!;
  if (dir === 'cw') {
    g.translate(c.width, 0);
    g.rotate(Math.PI / 2);
  } else {
    g.translate(0, c.height);
    g.rotate(-Math.PI / 2);
  }
  g.drawImage(src, 0, 0);
  return c;
}

export function flipCanvas(src: HTMLCanvasElement, axis: 'h' | 'v'): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d')!;
  if (axis === 'h') {
    g.translate(c.width, 0);
    g.scale(-1, 1);
  } else {
    g.translate(0, c.height);
    g.scale(1, -1);
  }
  g.drawImage(src, 0, 0);
  return c;
}

/** 크게 줄일 때는 절반씩 단계적으로 줄여야 계단 현상이 생기지 않는다. */
export function resizeCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const half = makeCanvas(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2));
    const g = half.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = makeCanvas(w, h);
  const g = out.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, w, h);
  return out;
}

/** 밝기·대비·채도 보정. ctx.filter 는 브라우저마다 지원이 달라 픽셀을 직접 계산한다. */
export function adjustCanvas(src: HTMLCanvasElement, a: Adjust): HTMLCanvasElement {
  if (isNeutral(a)) return src;
  const out = makeCanvas(src.width, src.height);
  const g = out.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, out.width, out.height);
  const d = img.data;

  // 밝기·대비·반전은 채널별 조회표 하나로 합칠 수 있다
  const lut = new Uint8ClampedArray(256);
  const b = (a.brightness / 100) * 255 * 0.6;
  const c = a.contrast >= 0 ? 1 + (a.contrast / 100) * 1.5 : 1 + a.contrast / 100;
  for (let i = 0; i < 256; i++) {
    let v = (i - 128) * c + 128 + b;
    if (a.invert) v = 255 - v;
    lut[i] = v;
  }
  const sat = a.gray ? 0 : a.saturation >= 0 ? 1 + (a.saturation / 100) * 1.5 : 1 + a.saturation / 100;
  const doSat = sat !== 1;

  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]];
    let gg = lut[d[i + 1]];
    let bb = lut[d[i + 2]];
    if (doSat) {
      const l = 0.299 * r + 0.587 * gg + 0.114 * bb;
      r = l + (r - l) * sat;
      gg = l + (gg - l) * sat;
      bb = l + (bb - l) * sat;
    }
    d[i] = r;
    d[i + 1] = gg;
    d[i + 2] = bb;
  }
  g.putImageData(img, 0, 0);
  return out;
}

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export function canvasToBlob(c: HTMLCanvasElement, format: ExportFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let src = c;
    if (format === 'jpeg') {
      // JPEG 는 투명을 못 담으므로 흰 바탕을 깐다
      src = makeCanvas(c.width, c.height);
      const g = src.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, src.width, src.height);
      g.drawImage(c, 0, 0);
    }
    src.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들 수 없습니다'))), `image/${format}`, quality);
  });
}

export async function captureScreen(): Promise<HTMLCanvasElement> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    // 공유 선택 창이 사라지고 첫 화면이 안정될 때까지 잠깐 기다린다
    await new Promise((r) => setTimeout(r, 350));
    const c = makeCanvas(video.videoWidth, video.videoHeight);
    c.getContext('2d')!.drawImage(video, 0, 0);
    video.pause();
    video.srcObject = null;
    return c;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
