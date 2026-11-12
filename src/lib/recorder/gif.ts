// GIF89a 인코더. 화면 녹화에 맞춰 만들었다:
// - 전체 프레임에서 뽑은 공용 팔레트 하나 (255색 + 투명 1)
// - 앞 프레임과 같은 픽셀은 투명으로 두고, 바뀐 영역만 잘라서 기록 → 화면 녹화는 용량이 크게 준다
// - 아무것도 안 바뀐 프레임은 앞 프레임의 표시 시간만 늘린다

const BINS = 32768; // 채널당 5비트
const TRANSPARENT = 255;

export function newHistogram(): Uint32Array {
  return new Uint32Array(BINS);
}

export function addToHistogram(hist: Uint32Array, rgba: Uint8ClampedArray, step = 1): void {
  for (let p = 0; p < rgba.length; p += 4 * step) {
    hist[((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3)]++;
  }
}

const expand = (v: number) => (v << 3) | (v >> 2);

interface Box {
  bins: number[];
  pop: number;
  axis: number;
  range: number;
}

function makeBox(bins: number[], hist: Uint32Array): Box {
  const lo = [31, 31, 31];
  const hi = [0, 0, 0];
  let pop = 0;
  for (const bin of bins) {
    pop += hist[bin];
    const c = [bin >> 10, (bin >> 5) & 31, bin & 31];
    for (let k = 0; k < 3; k++) {
      if (c[k] < lo[k]) lo[k] = c[k];
      if (c[k] > hi[k]) hi[k] = c[k];
    }
  }
  // 눈은 초록에 가장 민감하다
  const w = [hi[0] - lo[0], (hi[1] - lo[1]) * 1.2, (hi[2] - lo[2]) * 0.8];
  const axis = w[0] >= w[1] && w[0] >= w[2] ? 0 : w[1] >= w[2] ? 1 : 2;
  return { bins, pop, axis, range: w[axis] };
}

/** 중간값 자르기(median cut)로 팔레트를 만든다. lut 는 5비트 색 → 팔레트 번호. */
export function buildPalette(hist: Uint32Array, maxColors = 255): { palette: Uint8Array; count: number; lut: Uint8Array } {
  const all: number[] = [];
  for (let i = 0; i < BINS; i++) if (hist[i]) all.push(i);
  const boxes: Box[] = all.length ? [makeBox(all, hist)] : [];
  while (boxes.length < maxColors) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.bins.length < 2) continue;
      const score = (b.range + 0.5) * Math.sqrt(b.pop);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    const box = boxes[best];
    const shift = box.axis === 0 ? 10 : box.axis === 1 ? 5 : 0;
    box.bins.sort((x, y) => ((x >> shift) & 31) - ((y >> shift) & 31));
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.bins.length - 1; i++) {
      acc += hist[box.bins[i]];
      cut = i + 1;
      if (acc * 2 >= box.pop) break;
    }
    boxes[best] = makeBox(box.bins.slice(0, cut), hist);
    boxes.push(makeBox(box.bins.slice(cut), hist));
  }

  const palette = new Uint8Array(256 * 3);
  boxes.forEach((box, i) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const bin of box.bins) {
      const n = hist[bin];
      r += expand(bin >> 10) * n;
      g += expand((bin >> 5) & 31) * n;
      b += expand(bin & 31) * n;
    }
    palette[i * 3] = Math.round(r / box.pop);
    palette[i * 3 + 1] = Math.round(g / box.pop);
    palette[i * 3 + 2] = Math.round(b / box.pop);
  });

  const count = boxes.length;
  const lut = new Uint8Array(BINS);
  for (let bin = 0; bin < BINS; bin++) {
    const r = expand(bin >> 10);
    const g = expand((bin >> 5) & 31);
    const b = expand(bin & 31);
    let bestD = Infinity;
    let bestI = 0;
    for (let i = 0; i < count; i++) {
      const dr = r - palette[i * 3];
      const dg = g - palette[i * 3 + 1];
      const db = b - palette[i * 3 + 2];
      const d = dr * dr * 2 + dg * dg * 4 + db * db;
      if (d < bestD) {
        bestD = d;
        bestI = i;
        if (!d) break;
      }
    }
    lut[bin] = bestI;
  }
  return { palette, count, lut };
}

export function mapPixels(rgba: Uint8ClampedArray, lut: Uint8Array, out = new Uint8Array(rgba.length >> 2)): Uint8Array {
  for (let p = 0, i = 0; p < rgba.length; p += 4, i++) {
    out[i] = lut[((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3)];
  }
  return out;
}

class Bytes {
  buf = new Uint8Array(1 << 16);
  len = 0;
  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  u8(v: number) {
    this.grow(1);
    this.buf[this.len++] = v;
  }
  u16(v: number) {
    this.grow(2);
    this.buf[this.len++] = v & 255;
    this.buf[this.len++] = (v >> 8) & 255;
  }
  bytes(a: ArrayLike<number>) {
    this.grow(a.length);
    this.buf.set(a, this.len);
    this.len += a.length;
  }
}

const HSIZE = 5003;
const htab = new Int32Array(HSIZE);
const codetab = new Int32Array(HSIZE);

/** GIF 방식 LZW. 255바이트 단위 블록으로 out 에 쓴다. */
export function lzwEncode(pixels: Uint8Array, minCodeSize: number, out: Bytes): void {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let next = eoi + 1;
  let codeSize = minCodeSize + 1;
  let acc = 0;
  let bits = 0;
  const block = new Uint8Array(255);
  let blockLen = 0;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      block[blockLen++] = acc & 255;
      acc >>>= 8;
      bits -= 8;
      if (blockLen === 255) {
        out.u8(255);
        out.bytes(block);
        blockLen = 0;
      }
    }
  };

  out.u8(minCodeSize);
  htab.fill(-1);
  emit(clear);
  if (pixels.length) {
    let prefix = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
      const k = pixels[i];
      const key = (k << 12) | prefix;
      let h = (k << 4) ^ prefix;
      let found = false;
      while (htab[h] !== -1) {
        if (htab[h] === key) {
          prefix = codetab[h];
          found = true;
          break;
        }
        if (++h === HSIZE) h = 0;
      }
      if (found) continue;
      emit(prefix);
      if (next < 4096) {
        htab[h] = key;
        codetab[h] = next++;
        if (next > 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        emit(clear);
        htab.fill(-1);
        next = eoi + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
    emit(prefix);
  }
  emit(eoi);
  if (bits > 0) block[blockLen++] = acc & 255;
  if (blockLen) {
    out.u8(blockLen);
    out.bytes(block.subarray(0, blockLen));
  }
  out.u8(0);
}

interface Pending {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Uint8Array;
  delay: number;
  transparent: boolean;
}

export class GifEncoder {
  private out = new Bytes();
  private prev: Uint8Array | null = null;
  private pending: Pending | null = null;
  frames = 0;

  /** palette: RGB 가 이어진 배열 (최대 255색). 255번은 투명으로 쓴다. */
  constructor(
    readonly width: number,
    readonly height: number,
    palette: Uint8Array,
    loop = 0,
  ) {
    const o = this.out;
    o.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    o.u16(width);
    o.u16(height);
    o.bytes([0xf7, 0, 0]); // 공용 팔레트 256색
    const table = new Uint8Array(768);
    table.set(palette.subarray(0, 765));
    o.bytes(table);
    o.bytes([0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1]);
    o.u16(loop);
    o.u8(0);
  }

  /** indices: 팔레트 번호 (width*height). delay 는 1/100초. */
  addFrame(indices: Uint8Array, delay: number): void {
    const { width: W, height: H } = this;
    const prev = this.prev;
    if (!prev) {
      this.pending = { x: 0, y: 0, w: W, h: H, pixels: indices.slice(), delay, transparent: false };
      this.prev = indices.slice();
      return;
    }
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        if (indices[i] !== prev[i]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    if (x1 < 0) {
      // 바뀐 게 없다: 앞 프레임을 더 오래 보여 준다
      this.pending!.delay += delay;
      return;
    }
    this.flush();
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const pixels = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = (y0 + y) * W + x0;
      for (let x = 0; x < w; x++) {
        const v = indices[row + x];
        pixels[y * w + x] = v === prev[row + x] ? TRANSPARENT : v;
      }
    }
    this.pending = { x: x0, y: y0, w, h, pixels, delay, transparent: true };
    prev.set(indices);
  }

  private flush() {
    const f = this.pending;
    if (!f) return;
    const o = this.out;
    o.bytes([0x21, 0xf9, 4, (1 << 2) | (f.transparent ? 1 : 0)]);
    o.u16(Math.min(65535, Math.max(2, Math.round(f.delay))));
    o.bytes([f.transparent ? TRANSPARENT : 0, 0]);
    o.u8(0x2c);
    o.u16(f.x);
    o.u16(f.y);
    o.u16(f.w);
    o.u16(f.h);
    o.u8(0);
    lzwEncode(f.pixels, 8, o);
    this.frames++;
    this.pending = null;
  }

  get size(): number {
    return this.out.len;
  }

  finish(): Uint8Array<ArrayBuffer> {
    this.flush();
    this.out.u8(0x3b);
    return this.out.buf.slice(0, this.out.len);
  }
}
