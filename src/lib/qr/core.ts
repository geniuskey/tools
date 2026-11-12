// QR 코드 인코더 (ISO/IEC 18004, 모델 2, 버전 1~40).
// 숫자 · 영숫자 · 바이트(UTF-8) 모드 가운데 가장 짧은 것을 고르고, 여덟 가지 마스크를 모두 평가해 가장 읽기 좋은 것을 쓴다.

export type Ecl = 'L' | 'M' | 'Q' | 'H';
export const ECLS: Ecl[] = ['L', 'M', 'Q', 'H'];
const FORMAT_BITS: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };

// 블록 하나의 오류 정정 코드워드 수 [수준][버전]
const ECC_PER_BLOCK: Record<Ecl, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
// 오류 정정 블록 수 [수준][버전]
const BLOCKS: Record<Ecl, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** 기능 패턴을 뺀, 데이터와 오류 정정에 쓸 수 있는 모듈 수 */
export function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

export function dataCodewords(ver: number, ecl: Ecl): number {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * BLOCKS[ecl][ver];
}

// ── 리드-솔로몬 (GF(2^8), 원시 다항식 0x11D) ────────────────

export function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < degree) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 2);
  }
  return out;
}

export function rsRemainder(data: ArrayLike<number>, degree: number): number[] {
  const divisor = rsDivisor(degree);
  const out = new Array<number>(degree).fill(0);
  for (let k = 0; k < data.length; k++) {
    const factor = data[k] ^ out.shift()!;
    out.push(0);
    for (let i = 0; i < degree; i++) out[i] ^= gfMul(divisor[i], factor);
  }
  return out;
}

// ── 데이터 → 비트 ───────────────────────────────────────────

export type Mode = 'numeric' | 'alphanumeric' | 'byte';
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const MODE_BITS: Record<Mode, number> = { numeric: 1, alphanumeric: 2, byte: 4 };
const COUNT_BITS: Record<Mode, [number, number, number]> = { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] };

export function pickMode(text: string): Mode {
  if (/^\d+$/.test(text)) return 'numeric';
  if (/^[0-9A-Z $%*+\-./:]+$/.test(text)) return 'alphanumeric';
  return 'byte';
}

function segmentBits(text: string, mode: Mode): { bits: number[]; count: number } {
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  if (mode === 'numeric') {
    for (let i = 0; i < text.length; i += 3) {
      const part = text.slice(i, i + 3);
      put(+part, part.length * 3 + 1);
    }
    return { bits, count: text.length };
  }
  if (mode === 'alphanumeric') {
    for (let i = 0; i + 1 < text.length; i += 2) put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
    if (text.length % 2) put(ALNUM.indexOf(text[text.length - 1]), 6);
    return { bits, count: text.length };
  }
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) put(b, 8);
  return { bits, count: bytes.length };
}

export interface Qr {
  version: number;
  ecl: Ecl;
  mask: number;
  mode: Mode;
  size: number;
  /** size*size, 1 = 어두운 모듈 */
  modules: Uint8Array;
  /** 데이터 길이 (바이트 모드면 바이트 수, 아니면 글자 수) */
  length: number;
}

export class QrTooLongError extends Error {
  constructor() {
    super('내용이 너무 깁니다');
  }
}

export interface QrOptions {
  ecl?: Ecl;
  /** 같은 크기에서 더 높은 오류 정정 수준이 가능하면 올린다 */
  boost?: boolean;
  /** 테스트용: 마스크를 직접 고른다 */
  mask?: number;
}

export function encodeQr(text: string, options: QrOptions = {}): Qr {
  let ecl = options.ecl ?? 'M';
  const mode = pickMode(text);
  const seg = segmentBits(text, mode);
  const headerBits = (ver: number) => 4 + COUNT_BITS[mode][ver <= 9 ? 0 : ver <= 26 ? 1 : 2];

  let version = 1;
  for (; ; version++) {
    if (version > 40) throw new QrTooLongError();
    const countBits = headerBits(version) - 4;
    if (seg.count < 2 ** countBits && headerBits(version) + seg.bits.length <= dataCodewords(version, ecl) * 8) break;
  }
  const used = headerBits(version) + seg.bits.length;
  if (options.boost !== false) {
    for (const next of ECLS.slice(ECLS.indexOf(ecl) + 1)) if (used <= dataCodewords(version, next) * 8) ecl = next;
  }

  // 모드 · 길이 · 데이터 · 종료 · 채움
  const capacity = dataCodewords(version, ecl) * 8;
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(MODE_BITS[mode], 4);
  put(seg.count, headerBits(version) - 4);
  for (const b of seg.bits) bits.push(b);
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = new Uint8Array(capacity / 8);
  bits.forEach((b, i) => (data[i >>> 3] |= b << (7 - (i & 7))));

  const size = version * 4 + 17;
  const modules = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  drawFunctionPatterns(version, size, modules, fn);
  drawCodewords(addEcc(data, version, ecl), size, modules, fn);

  let mask = options.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m, size, modules, fn);
      drawFormat(ecl, m, size, modules, fn);
      const p = penalty(size, modules);
      if (p < best) {
        best = p;
        mask = m;
      }
      applyMask(m, size, modules, fn); // 되돌린다
    }
  }
  applyMask(mask, size, modules, fn);
  drawFormat(ecl, mask, size, modules, fn);
  return { version, ecl, mask, mode, size, modules, length: seg.count };
}

/** 데이터를 블록으로 나눠 오류 정정을 붙이고 번갈아 섞는다. */
export function addEcc(data: Uint8Array, ver: number, ecl: Ecl): Uint8Array {
  const blocks = BLOCKS[ecl][ver];
  const eccLen = ECC_PER_BLOCK[ecl][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const parts: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = Array.from(data.subarray(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1)));
    k += dat.length;
    const ecc = rsRemainder(dat, eccLen);
    if (i < shortBlocks) dat.push(0);
    parts.push(dat.concat(ecc));
  }
  const out = new Uint8Array(raw);
  let o = 0;
  for (let i = 0; i < parts[0].length; i++) {
    parts.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out[o++] = block[i];
    });
  }
  return out;
}

export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

function drawFunctionPatterns(ver: number, size: number, modules: Uint8Array, fn: Uint8Array) {
  const set = (x: number, y: number, dark: boolean) => {
    modules[y * size + x] = dark ? 1 : 0;
    fn[y * size + x] = 1;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const align = alignmentPositions(ver);
  const last = align.length - 1;
  align.forEach((cx, i) => {
    align.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  // 형식 정보 자리는 미리 잡아 둔다 (값은 마스크를 정한 뒤에)
  for (let i = 0; i < 9; i++) {
    if (!fn[i * size + 8]) set(8, i, false);
    if (!fn[8 * size + i]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }
  set(8, size - 8, true);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
}

export function formatBits(ecl: Ecl, mask: number): number {
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(ecl: Ecl, mask: number, size: number, modules: Uint8Array, fn: Uint8Array) {
  const bits = formatBits(ecl, mask);
  const set = (x: number, y: number, i: number) => {
    modules[y * size + x] = (bits >>> i) & 1;
    fn[y * size + x] = 1;
  };
  for (let i = 0; i <= 5; i++) set(8, i, i);
  set(8, 7, 6);
  set(8, 8, 7);
  set(7, 8, 8);
  for (let i = 9; i < 15; i++) set(14 - i, 8, i);
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, i);
}

function drawCodewords(data: Uint8Array, size: number, modules: Uint8Array, fn: Uint8Array) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y * size + x] && i < data.length * 8) {
          modules[y * size + x] = (data[i >>> 3] >>> (7 - (i & 7))) & 1;
          i++;
        }
      }
    }
  }
}

function applyMask(mask: number, size: number, modules: Uint8Array, fn: Uint8Array) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (fn[y * size + x]) continue;
      let flip: boolean;
      switch (mask) {
        case 0: flip = (x + y) % 2 === 0; break;
        case 1: flip = y % 2 === 0; break;
        case 2: flip = x % 3 === 0; break;
        case 3: flip = (x + y) % 3 === 0; break;
        case 4: flip = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: flip = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: flip = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: flip = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (flip) modules[y * size + x] ^= 1;
    }
  }
}

/** 읽기 어려운 무늬에 매기는 벌점 (낮을수록 좋다) */
function penalty(size: number, m: Uint8Array): number {
  let score = 0;
  const line = new Uint8Array(size);
  const scanLine = () => {
    // 같은 색이 5개 이상 이어짐
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    // 위치 찾기 무늬와 닮은 1:1:3:1:1 (옆에 밝은 칸 4개)
    for (let i = 0; i + 11 <= size; i++) {
      const p = (k: number) => line[i + k];
      if (p(0) && !p(1) && p(2) && p(3) && p(4) && !p(5) && p(6) && !p(7) && !p(8) && !p(9) && !p(10)) score += 40;
      if (!p(0) && !p(1) && !p(2) && !p(3) && p(4) && !p(5) && p(6) && p(7) && p(8) && !p(9) && p(10)) score += 40;
    }
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) line[x] = m[y * size + x];
    scanLine();
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) line[y] = m[y * size + x];
    scanLine();
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = m[y * size + x];
      dark += c;
      if (x + 1 < size && y + 1 < size && c === m[y * size + x + 1] && c === m[(y + 1) * size + x] && c === m[(y + 1) * size + x + 1]) score += 3;
    }
  }
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/** 이 수준에서 담을 수 있는 최대 길이 (가장 큰 버전 기준, 지금 모드로) */
export function maxLength(mode: Mode, ecl: Ecl): number {
  const bits = dataCodewords(40, ecl) * 8 - 4 - COUNT_BITS[mode][2];
  if (mode === 'numeric') return Math.floor(bits / 10) * 3 + (bits % 10 >= 7 ? 2 : bits % 10 >= 4 ? 1 : 0);
  if (mode === 'alphanumeric') return Math.floor(bits / 11) * 2 + (bits % 11 >= 6 ? 1 : 0);
  return Math.floor(bits / 8);
}
