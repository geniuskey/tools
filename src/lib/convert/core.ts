// 이미지 일괄 변환의 계산 부분. 화면 · 캔버스와 무관해서 그대로 테스트할 수 있다.

export type Format = 'jpeg' | 'png' | 'webp' | 'avif';
export const MIME: Record<Format, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
export const EXT: Record<Format, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };
export const FORMAT_NAME: Record<Format, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF' };
/** 품질 값이 듣는 형식 (PNG 는 무손실이라 품질이 없다) */
export const lossy = (f: Format) => f !== 'png';

/** 파일 앞머리로 실제 형식을 알아낸다. 확장자는 믿지 않는다. */
export function sniff(head: Uint8Array): string {
  const at = (i: number, s: string) => [...s].every((c, k) => head[i + k] === c.charCodeAt(0));
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg';
  if (head[0] === 0x89 && at(1, 'PNG')) return 'png';
  if (at(0, 'GIF8')) return 'gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
  if (at(0, 'BM')) return 'bmp';
  if (at(4, 'ftyp')) {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
    if (/^avi[fs]$/.test(brand)) return 'avif';
  }
  const text = new TextDecoder().decode(head.subarray(0, 256)).trimStart();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'svg';
  return '';
}

export interface Size {
  w: number;
  h: number;
}

export type Resize =
  | { mode: 'none' }
  /** 긴 쪽을 px 이하로 */
  | { mode: 'long'; px: number }
  /** 가로 · 세로 상자 안에 들어가게 */
  | { mode: 'fit'; w: number; h: number }
  | { mode: 'percent'; percent: number };

/** 비율을 지키며 줄인 크기. 원본보다 키우지는 않는다. */
export function fitSize(src: Size, r: Resize): Size {
  let s = 1;
  if (r.mode === 'long' && r.px > 0) s = r.px / Math.max(src.w, src.h);
  else if (r.mode === 'fit') s = Math.min(r.w > 0 ? r.w / src.w : Infinity, r.h > 0 ? r.h / src.h : Infinity);
  else if (r.mode === 'percent' && r.percent > 0) s = r.percent / 100;
  if (!Number.isFinite(s) || s >= 1) return { ...src };
  return scaled(src, s);
}

export function scaled(src: Size, s: number): Size {
  return { w: Math.max(1, Math.round(src.w * s)), h: Math.max(1, Math.round(src.h * s)) };
}

/**
 * 크게 줄일 때는 절반씩 여러 번 줄여야 계단 현상이 없다.
 * 원본에서 목표까지 거쳐 갈 크기들 (마지막이 목표).
 */
export function downscaleSteps(src: Size, dst: Size): Size[] {
  const out: Size[] = [];
  let cur = src;
  while (cur.w / 2 > dst.w && cur.h / 2 > dst.h) {
    cur = { w: Math.ceil(cur.w / 2), h: Math.ceil(cur.h / 2) };
    out.push(cur);
  }
  out.push(dst);
  return out;
}

export interface Encoded<B> {
  blob: B;
  size: number;
}
export interface TargetResult<B> extends Encoded<B> {
  quality: number;
  /** 목표를 맞추려고 크기를 더 줄였다면 그 배율 (1 = 그대로) */
  scale: number;
  /** 끝내 목표보다 크면 false */
  met: boolean;
}

const Q_MIN = 0.3;
const Q_MAX = 0.95;

/**
 * 목표 용량 이하에서 가장 좋은 품질을 찾는다.
 * 품질이 오르면 용량도 오른다고 보고 이분 탐색하고, 가장 낮은 품질로도 넘치면 크기를 줄여 다시 찾는다.
 */
export async function fitToBytes<B>(
  encode: (quality: number, scale: number) => Promise<Encoded<B>>,
  target: number,
  opts: { adjustable?: boolean; maxQuality?: number } = {},
): Promise<TargetResult<B>> {
  const adjustable = opts.adjustable ?? true;
  const top = opts.maxQuality ?? Q_MAX;
  let scale = 1;
  let smallest: TargetResult<B> | null = null;
  for (let round = 0; round < 8; round++) {
    if (!adjustable) {
      // 무손실: 품질로는 줄일 수 없으니 크기만 줄인다
      const e = await encode(1, scale);
      if (e.size <= target) return { ...e, quality: 1, scale, met: true };
      if (!smallest || e.size < smallest.size) smallest = { ...e, quality: 1, scale, met: false };
      scale *= clamp(Math.sqrt(target / e.size) * 0.95, 0.4, 0.9);
      continue;
    }
    const hi = await encode(top, scale);
    if (hi.size <= target) return { ...hi, quality: top, scale, met: true };
    const lo = await encode(Q_MIN, scale);
    if (lo.size <= target) {
      let best: TargetResult<B> = { ...lo, quality: Q_MIN, scale, met: true };
      let a = Q_MIN;
      let b = top;
      for (let i = 0; i < 6; i++) {
        const q = Math.round(((a + b) / 2) * 100) / 100;
        if (q <= a || q >= b) break;
        const e = await encode(q, scale);
        if (e.size <= target) {
          best = { ...e, quality: q, scale, met: true };
          a = q;
        } else b = q;
      }
      return best;
    }
    if (!smallest || lo.size < smallest.size) smallest = { ...lo, quality: Q_MIN, scale, met: false };
    // 용량은 대략 픽셀 수에 비례한다
    scale *= clamp(Math.sqrt(target / lo.size) * 0.95, 0.4, 0.9);
  }
  return smallest!;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function formatBytes(n: number): string {
  if (n < 1000) return `${n}B`;
  if (n < 1000 * 1024) return `${trim(n / 1024)}KB`;
  if (n < 1000 * 1024 * 1024) return `${trim(n / 1024 / 1024)}MB`;
  return `${trim(n / 1024 / 1024 / 1024)}GB`;
}
const trim = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/\.?0+$/, ''));

/** 얼마나 줄었는지 (−72%). 늘었으면 +. */
export function savedPercent(before: number, after: number): string {
  if (!before) return '';
  const p = Math.round((after / before - 1) * 100);
  return p === 0 ? '±0%' : p > 0 ? `+${p}%` : `−${-p}%`;
}

export interface Naming {
  prefix: string;
  suffix: string;
  /** 이름을 버리고 번호만 매긴다 (prefix + 001) */
  numbered: boolean;
}

const BAD = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 결과 파일 이름들. 서로 겹치면 뒤에 -2, -3 을 붙인다 (대소문자 무시). ext 는 하나거나 파일마다 하나. */
export function outputNames(sources: readonly string[], ext: string | readonly string[], naming: Naming): string[] {
  const used = new Set<string>();
  const width = Math.max(3, String(sources.length).length);
  return sources.map((src, i) => {
    const x = typeof ext === 'string' ? ext : ext[i];
    const stem = src.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || 'image';
    const base = ((naming.numbered ? `${naming.prefix}${String(i + 1).padStart(width, '0')}` : `${naming.prefix}${stem}`) + naming.suffix).replace(BAD, '_').trim() || 'image';
    let name = `${base}.${x}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}.${x}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// ── EXIF: 지워지는 정보가 무엇인지 보여 주려고 읽는다 ─────────────────────────

export interface ExifInfo {
  /** 1~8. 1 이 바로 선 방향 */
  orientation: number;
  make: string;
  model: string;
  /** 찍은 시각 (YYYY:MM:DD HH:MM:SS) */
  taken: string;
  software: string;
  /** 위치(GPS)가 들어 있는가 */
  gps: { lat: number; lon: number } | null;
  hasGps: boolean;
}

/** JPEG 의 EXIF(APP1)를 읽는다. 없거나 깨졌으면 null. */
export function readExif(bytes: Uint8Array): ExifInfo | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1];
    if (marker === 0xda || marker === 0xd9) return null; // 그림 데이터 시작
    const len = view.getUint16(p + 2);
    if (len < 2) return null;
    if (marker === 0xe1 && len >= 8 && String.fromCharCode(...bytes.subarray(p + 4, p + 8)) === 'Exif') {
      try {
        return parseTiff(new DataView(bytes.buffer, bytes.byteOffset + p + 10, Math.min(len - 8, bytes.length - p - 10)));
      } catch {
        return null;
      }
    }
    p += 2 + len;
  }
  return null;
}

function parseTiff(v: DataView): ExifInfo | null {
  const order = v.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const le = order === 0x4949;
  if (v.getUint16(2, le) !== 42) return null;
  const info: ExifInfo = { orientation: 1, make: '', model: '', taken: '', software: '', gps: null, hasGps: false };

  const ascii = (off: number, n: number) => {
    let s = '';
    for (let i = 0; i < n && off + i < v.byteLength; i++) {
      const c = v.getUint8(off + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  };
  const rational = (off: number) => {
    const d = v.getUint32(off + 4, le);
    return d ? v.getUint32(off, le) / d : 0;
  };
  /** IFD 를 돌며 항목마다 (태그, 형식, 개수, 값이 놓인 자리)를 넘긴다 */
  const walk = (ifd: number, visit: (tag: number, type: number, count: number, at: number) => void) => {
    if (ifd <= 0 || ifd + 2 > v.byteLength) return;
    const n = v.getUint16(ifd, le);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > v.byteLength) return;
      const type = v.getUint16(e + 2, le);
      const count = v.getUint32(e + 4, le);
      const unit = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] ?? 1;
      const at = unit * count <= 4 ? e + 8 : v.getUint32(e + 8, le);
      if (at + unit * count > v.byteLength) continue;
      visit(v.getUint16(e, le), type, count, at);
    }
  };

  let exifIfd = 0;
  let gpsIfd = 0;
  walk(v.getUint32(4, le), (tag, _type, count, at) => {
    if (tag === 0x0112) info.orientation = v.getUint16(at, le);
    else if (tag === 0x010f) info.make = ascii(at, count);
    else if (tag === 0x0110) info.model = ascii(at, count);
    else if (tag === 0x0131) info.software = ascii(at, count);
    else if (tag === 0x0132 && !info.taken) info.taken = ascii(at, count);
    else if (tag === 0x8769) exifIfd = v.getUint32(at, le);
    else if (tag === 0x8825) gpsIfd = v.getUint32(at, le);
  });
  walk(exifIfd, (tag, _type, count, at) => {
    if (tag === 0x9003) info.taken = ascii(at, count);
  });
  if (gpsIfd) {
    const g = { latRef: '', lonRef: '', lat: NaN, lon: NaN };
    const dms = (at: number) => rational(at) + rational(at + 8) / 60 + rational(at + 16) / 3600;
    walk(gpsIfd, (tag, _type, count, at) => {
      info.hasGps = true;
      if (tag === 1) g.latRef = ascii(at, count);
      else if (tag === 2 && count === 3) g.lat = dms(at);
      else if (tag === 3) g.lonRef = ascii(at, count);
      else if (tag === 4 && count === 3) g.lon = dms(at);
    });
    if (!Number.isNaN(g.lat) && !Number.isNaN(g.lon)) info.gps = { lat: g.latRef === 'S' ? -g.lat : g.lat, lon: g.lonRef === 'W' ? -g.lon : g.lon };
  }
  if (!Number.isInteger(info.orientation) || info.orientation < 1 || info.orientation > 8) info.orientation = 1;
  return info;
}

/**
 * 위치가 든 EXIF 조각(APP1)을 만든다. 예시 사진에 넣어, 변환하면 정말 빠지는지 보여 주는 데 쓴다.
 */
export function buildExifSegment(o: { make: string; model: string; taken: string; lat: number; lon: number; orientation?: number }): Uint8Array {
  const tiff = new Uint8Array(360);
  const v = new DataView(tiff.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (tiff[at + i] = c.charCodeAt(0) & 0x7f));
  put(0, 'MM');
  v.setUint16(2, 42);
  v.setUint32(4, 8);
  let e = 0;
  const ifd = (at: number, n: number) => {
    v.setUint16(at, n);
    e = at + 2;
  };
  const entry = (tag: number, type: number, count: number, value: number | string) => {
    v.setUint16(e, tag);
    v.setUint16(e + 2, type);
    v.setUint32(e + 4, count);
    if (typeof value === 'string') put(e + 8, value);
    else if (type === 3) v.setUint16(e + 8, value);
    else v.setUint32(e + 8, value);
    e += 12;
  };
  const text = (at: number, s: string, max: number) => (put(at, s.slice(0, max - 1)), Math.min(s.length, max - 1) + 1);
  ifd(8, 5);
  entry(0x010f, 2, text(80, o.make, 30), 80);
  entry(0x0110, 2, text(110, o.model, 30), 110);
  entry(0x0112, 3, 1, o.orientation ?? 1);
  entry(0x8769, 4, 1, 150);
  entry(0x8825, 4, 1, 200);
  ifd(150, 1);
  entry(0x9003, 2, text(170, o.taken, 20), 170);
  ifd(200, 4);
  entry(1, 2, 2, o.lat < 0 ? 'S' : 'N');
  entry(2, 5, 3, 260);
  entry(3, 2, 2, o.lon < 0 ? 'W' : 'E');
  entry(4, 5, 3, 300);
  const dms = (at: number, deg: number) => {
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const sec = Math.round(((a - d) * 60 - m) * 60 * 100);
    [[d, 1], [m, 1], [sec, 100]].forEach(([n, den], i) => (v.setUint32(at + i * 8, n), v.setUint32(at + i * 8 + 4, den)));
  };
  dms(260, o.lat);
  dms(300, o.lon);
  const len = tiff.length + 8;
  const out = new Uint8Array(len + 2);
  out.set([0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  out.set(tiff, 10);
  return out;
}

/** JPEG 의 맨 앞(SOI 바로 뒤)에 조각을 끼운다 */
export function insertSegment(jpeg: Uint8Array, segment: Uint8Array): Uint8Array {
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2));
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

/** 사람이 읽는 요약: 무엇이 지워지는가 */
export function exifSummary(e: ExifInfo | null): string[] {
  if (!e) return [];
  const out: string[] = [];
  if (e.hasGps) out.push('위치');
  if (e.make || e.model) out.push('기기');
  if (e.taken) out.push('찍은 시각');
  return out;
}

// ── ZIP: 이미 압축된 그림이라 다시 압축하지 않고 그대로 담는다 (저장 방식) ────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** 압축하지 않는 ZIP. 파일 이름은 UTF-8 (한글 이름이 깨지지 않게 표시 비트를 켠다). */
export function zipStore(entries: readonly ZipEntry[], date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const items = entries.map((e) => ({ name: enc.encode(e.name), data: e.data, crc: crc32(e.data), offset: 0 }));
  const total = items.reduce((n, it) => n + 30 + it.name.length + it.data.length + 46 + it.name.length, 22);
  if (total > 0xffffffff || items.length > 0xffff) throw new Error('ZIP 한 파일로 담기에는 너무 큽니다 (4GB · 65,535개까지).');
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  let p = 0;
  for (const it of items) {
    it.offset = p;
    v.setUint32(p, 0x04034b50, true);
    v.setUint16(p + 4, 20, true);
    v.setUint16(p + 6, 0x0800, true);
    v.setUint16(p + 8, 0, true);
    v.setUint16(p + 10, time, true);
    v.setUint16(p + 12, day, true);
    v.setUint32(p + 14, it.crc, true);
    v.setUint32(p + 18, it.data.length, true);
    v.setUint32(p + 22, it.data.length, true);
    v.setUint16(p + 26, it.name.length, true);
    v.setUint16(p + 28, 0, true);
    out.set(it.name, p + 30);
    out.set(it.data, p + 30 + it.name.length);
    p += 30 + it.name.length + it.data.length;
  }
  const dirStart = p;
  for (const it of items) {
    v.setUint32(p, 0x02014b50, true);
    v.setUint16(p + 4, 20, true);
    v.setUint16(p + 6, 20, true);
    v.setUint16(p + 8, 0x0800, true);
    v.setUint16(p + 10, 0, true);
    v.setUint16(p + 12, time, true);
    v.setUint16(p + 14, day, true);
    v.setUint32(p + 16, it.crc, true);
    v.setUint32(p + 20, it.data.length, true);
    v.setUint32(p + 24, it.data.length, true);
    v.setUint16(p + 28, it.name.length, true);
    // extra, comment, disk, 내부 속성, 외부 속성은 0
    v.setUint32(p + 42, it.offset, true);
    out.set(it.name, p + 46);
    p += 46 + it.name.length;
  }
  v.setUint32(p, 0x06054b50, true);
  v.setUint16(p + 8, items.length, true);
  v.setUint16(p + 10, items.length, true);
  v.setUint32(p + 12, p - dirStart, true);
  v.setUint32(p + 16, dirStart, true);
  return out;
}
