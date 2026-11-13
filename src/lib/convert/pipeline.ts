// 브라우저에서 하는 일: 읽기(디코딩) → 크기 줄이기 → 다시 담기(인코딩).
import {
  MIME,
  buildExifSegment,
  downscaleSteps,
  fitSize,
  fitToBytes,
  insertSegment,
  lossy,
  readExif,
  scaled,
  sniff,
  type ExifInfo,
  type Format,
  type Resize,
  type Size,
} from './core';

export interface Settings {
  /** same = 원본 형식 그대로 (담을 수 없는 형식이면 JPG) */
  format: Format | 'same';
  resize: Resize;
  sizing: 'quality' | 'target';
  /** 0.3 ~ 1 */
  quality: number;
  targetBytes: number;
  /** 투명한 곳을 채울 색 (JPG 처럼 투명을 못 담는 형식에서) */
  background: string;
}

export interface Probe {
  /** 내용으로 알아낸 형식 (jpeg, png, heic …) */
  kind: string;
  exif: ExifInfo | null;
}

export interface Converted {
  blob: Blob;
  format: Format;
  src: Size;
  out: Size;
  /** 쓴 품질 (무손실이면 1) */
  quality: number;
  /** 목표 용량을 맞췄는가 (품질 모드에서는 항상 true) */
  met: boolean;
  /** 목표 용량 때문에 크기를 더 줄였는가 */
  shrunk: boolean;
  /** 목록에 보일 작은 그림 */
  thumb: string;
}

export class ConvertError extends Error {}

export async function probe(file: Blob): Promise<Probe> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const kind = sniff(head);
  return { kind, exif: kind === 'jpeg' ? readExif(head) : null };
}

/** 이 브라우저의 캔버스가 실제로 만들어 주는 형식만 고르게 한다 */
export async function supportedFormats(): Promise<Format[]> {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  c.getContext('2d')!.fillRect(0, 0, 2, 2);
  const out: Format[] = [];
  for (const f of ['jpeg', 'png', 'webp', 'avif'] as Format[]) {
    const b = await toBlob(c, f, 0.8).catch(() => null);
    if (b && b.type === MIME[f]) out.push(f);
  }
  return out;
}

function toBlob(c: HTMLCanvasElement, f: Format, q: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new ConvertError('이 크기로는 만들 수 없습니다.'))), MIME[f], q));
}

type Source = { draw: CanvasImageSource; size: Size; close(): void };

async function decode(file: Blob, kind: string): Promise<Source> {
  if (kind !== 'svg') {
    try {
      // 사진에 적힌 방향대로 바로 세워서 읽는다
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { draw: bmp, size: { w: bmp.width, h: bmp.height }, close: () => bmp.close() };
    } catch {}
  }
  const url = URL.createObjectURL(kind === 'svg' ? new Blob([file], { type: 'image/svg+xml' }) : file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty');
    return { draw: img, size: { w: img.naturalWidth, h: img.naturalHeight }, close: () => {} };
  } catch {
    throw new ConvertError(
      kind === 'heic'
        ? '이 브라우저는 HEIC 를 열지 못합니다. Safari 에서는 열립니다.'
        : kind
          ? '이 브라우저가 열지 못하는 그림입니다.'
          : '그림 파일이 아니거나 깨졌습니다.',
    );
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// 브라우저마다 캔버스 한 변 · 넓이에 한계가 있다. 넘으면 조용히 빈 그림이 나오므로 미리 막는다.
const MAX_SIDE = 16384;
const MAX_AREA = 16384 * 16384;

function render(src: Source, dst: Size, background: string | null): HTMLCanvasElement {
  if (dst.w > MAX_SIDE || dst.h > MAX_SIDE || dst.w * dst.h > MAX_AREA) throw new ConvertError(`너무 큽니다 (${dst.w} × ${dst.h}). 크기를 줄여 주세요.`);
  let from: CanvasImageSource = src.draw;
  let canvas!: HTMLCanvasElement;
  const steps = downscaleSteps(src.size, dst);
  steps.forEach((s, i) => {
    const c = document.createElement('canvas');
    c.width = s.w;
    c.height = s.h;
    const g = c.getContext('2d');
    if (!g) throw new ConvertError('메모리가 모자랍니다.');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (background && i === steps.length - 1) {
      g.fillStyle = background;
      g.fillRect(0, 0, s.w, s.h);
    }
    g.drawImage(from, 0, 0, s.w, s.h);
    if (canvas) canvas.width = canvas.height = 0;
    canvas = c;
    from = c;
  });
  return canvas;
}

export function targetFormat(kind: string, settings: Settings, supported: readonly Format[]): Format {
  if (settings.format !== 'same') return settings.format;
  return (supported as readonly string[]).includes(kind) ? (kind as Format) : 'jpeg';
}

export async function convert(file: Blob, kind: string, settings: Settings, supported: readonly Format[], wantThumb: boolean): Promise<Converted> {
  const format = targetFormat(kind, settings, supported);
  const src = await decode(file, kind);
  const made: HTMLCanvasElement[] = [];
  try {
    const base = fitSize(src.size, settings.resize);
    const bg = format === 'jpeg' ? settings.background : null;
    const canvases = new Map<number, HTMLCanvasElement>();
    const canvasAt = (scale: number) => {
      let c = canvases.get(scale);
      if (!c) {
        c = render(src, scale === 1 ? base : scaled(base, scale), bg);
        canvases.set(scale, c);
        made.push(c);
      }
      return c;
    };
    const encode = async (q: number, scale: number) => {
      const blob = await toBlob(canvasAt(scale), format, q);
      if (blob.type !== MIME[format]) throw new ConvertError('이 브라우저는 이 형식으로 저장하지 못합니다.');
      return { blob, size: blob.size };
    };

    let blob: Blob;
    let quality = lossy(format) ? settings.quality : 1;
    let met = true;
    let scale = 1;
    if (settings.sizing === 'target') {
      const r = await fitToBytes(encode, settings.targetBytes, { adjustable: lossy(format) });
      ({ blob, quality, met, scale } = r);
    } else {
      blob = (await encode(quality, 1)).blob;
    }
    const out = scale === 1 ? base : scaled(base, scale);

    let thumb = '';
    if (wantThumb) {
      const t = render(src, fitSize(src.size, { mode: 'long', px: 112 }), null);
      made.push(t);
      thumb = t.toDataURL('image/webp', 0.7);
      if (!thumb.startsWith('data:image/webp')) thumb = t.toDataURL('image/png');
    }
    return { blob, format, src: src.size, out, quality, met, shrunk: scale !== 1, thumb };
  } finally {
    src.close();
    // 큰 캔버스는 바로 비워야 여러 장을 이어서 해도 메모리가 쌓이지 않는다
    for (const c of made) c.width = c.height = 0;
  }
}

/** 체험용 사진. 한 장에는 위치 정보를 넣어 둔다. */
export async function sampleFiles(): Promise<File[]> {
  const scene = (w: number, h: number, hue: number, alpha: boolean) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    if (!alpha) {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, `hsl(${hue} 70% 62%)`);
      sky.addColorStop(0.6, `hsl(${hue + 40} 80% 80%)`);
      sky.addColorStop(1, `hsl(${hue + 70} 60% 88%)`);
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
    }
    g.fillStyle = `hsl(${hue + 50} 95% 78%)`;
    g.beginPath();
    g.arc(w * 0.72, h * 0.3, Math.min(w, h) * 0.11, 0, Math.PI * 2);
    g.fill();
    // 산 세 겹과 잔 무늬 (사진처럼 용량이 나오게)
    let seed = hue * 977 + w;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);
    for (let layer = 0; layer < 3; layer++) {
      g.fillStyle = `hsl(${hue + 150 + layer * 12} ${35 + layer * 8}% ${48 - layer * 12}%)`;
      g.beginPath();
      g.moveTo(0, h);
      let y = h * (0.5 + layer * 0.13);
      for (let x = 0; x <= w; x += w / 60) {
        y += (rnd() - 0.5) * h * 0.05;
        g.lineTo(x, y);
      }
      g.lineTo(w, h);
      g.fill();
    }
    const dots = (w * h) / 220;
    for (let i = 0; i < dots; i++) {
      g.fillStyle = `hsl(${hue + rnd() * 200} 50% ${30 + rnd() * 50}% / 0.35)`;
      g.fillRect(rnd() * w, h * 0.55 + rnd() * h * 0.45, 2 + rnd() * 3, 2 + rnd() * 3);
    }
    return c;
  };
  const blobOf = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res) => c.toBlob((b) => res(b!), type, q));

  const photo = new Uint8Array(await (await blobOf(scene(2400, 1600, 205, false), 'image/jpeg', 0.95)).arrayBuffer());
  const withGps = insertSegment(photo, buildExifSegment({ make: 'tools', model: 'Sample Camera', taken: '2026:10:03 16:20:00', lat: 37.5665, lon: 126.978 }));
  const tall = await blobOf(scene(1200, 1800, 20, false), 'image/jpeg', 0.95);
  const logo = await blobOf(scene(1000, 700, 280, true), 'image/png');
  return [
    new File([withGps as BlobPart], '서울 나들이.jpg', { type: 'image/jpeg' }),
    new File([tall], '노을.jpg', { type: 'image/jpeg' }),
    new File([logo], '투명 배경.png', { type: 'image/png' }),
  ];
}
