// 해시: MD5 와 CRC32 는 직접 만들었다 (조각조각 넣을 수 있어 큰 파일도 된다). SHA 와 HMAC 은 WebCrypto.

import { base64Decode, hexEncode } from './codec';

// ── MD5 (RFC 1321) ──
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x1_0000_0000) | 0;

export class Md5 {
  private state = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]);
  private block = new Uint8Array(64);
  private words = new Int32Array(16);
  private fill = 0;
  private length = 0;

  update(data: Uint8Array): this {
    this.length += data.length;
    let pos = 0;
    // 남아 있던 조각부터 채운다
    if (this.fill) {
      const take = Math.min(64 - this.fill, data.length);
      this.block.set(data.subarray(0, take), this.fill);
      this.fill += take;
      pos = take;
      if (this.fill < 64) return this;
      this.compress(this.block, 0);
      this.fill = 0;
    }
    for (; pos + 64 <= data.length; pos += 64) this.compress(data, pos);
    if (pos < data.length) {
      this.block.set(data.subarray(pos), 0);
      this.fill = data.length - pos;
    }
    return this;
  }

  /** 끝낸다. 부른 뒤에는 더 넣을 수 없다 */
  digest(): Uint8Array {
    const bits = this.length * 8;
    const pad = new Uint8Array(((this.fill < 56 ? 56 : 120) - this.fill) + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, bits >>> 0, true);
    view.setUint32(pad.length - 4, Math.floor(bits / 0x1_0000_0000), true);
    this.update(pad);
    const out = new Uint8Array(16);
    const o = new DataView(out.buffer);
    for (let i = 0; i < 4; i++) o.setInt32(i * 4, this.state[i], true);
    return out;
  }

  private compress(buf: Uint8Array, at: number) {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      const p = at + i * 4;
      w[i] = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24);
    }
    let a = this.state[0];
    let b = this.state[1];
    let c = this.state[2];
    let d = this.state[3];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const x = (a + f + K[i] + w[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) | 0;
    }
    this.state[0] = (this.state[0] + a) | 0;
    this.state[1] = (this.state[1] + b) | 0;
    this.state[2] = (this.state[2] + c) | 0;
    this.state[3] = (this.state[3] + d) | 0;
  }
}

export function md5(data: Uint8Array): Uint8Array {
  return new Md5().update(data).digest();
}

// ── CRC32 (zip · png · gzip 에서 쓰는 것) ──
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export class Crc32 {
  private crc = 0xffffffff;

  update(data: Uint8Array): this {
    let c = this.crc;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
    this.crc = c;
    return this;
  }

  /** 지금까지의 값 (부호 없는 32비트). 불러도 계속 넣을 수 있다 */
  value(): number {
    return (this.crc ^ 0xffffffff) >>> 0;
  }

  digest(): Uint8Array {
    const v = this.value();
    return new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
  }
}

export function crc32(data: Uint8Array): number {
  return new Crc32().update(data).value();
}

// ── SHA · HMAC (WebCrypto) ──
export type ShaAlg = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export const SHA_ALGS: ShaAlg[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

export async function sha(alg: ShaAlg, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(alg, data as BufferSource));
}

export async function hmac(alg: ShaAlg, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // 빈 키는 WebCrypto 가 받지 않는다 — HMAC 에서 빈 키와 0 한 바이트는 같은 값이다
  const raw = key.length ? key : new Uint8Array(1);
  const k = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: alg }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}

// ── 비교 ──
export type HashName = 'MD5' | ShaAlg | 'CRC32';
export const HASH_NAMES: HashName[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512', 'CRC32'];
export const HASH_BYTES: Record<HashName, number> = { MD5: 16, 'SHA-1': 20, 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64, CRC32: 4 };

/** 16진수 길이로 어떤 해시인지 짐작한다 (해시처럼 보이지 않으면 null) */
export function hashByHexLength(len: number): string | null {
  switch (len) {
    case 8:
      return 'CRC32';
    case 32:
      return 'MD5';
    case 40:
      return 'SHA-1';
    case 56:
      return 'SHA-224';
    case 64:
      return 'SHA-256';
    case 96:
      return 'SHA-384';
    case 128:
      return 'SHA-512';
    default:
      return null;
  }
}

/**
 * 사람이 붙여넣은 체크섬을 16진수 소문자로 고른다.
 * "sha256:abc…", "ABC… *파일이름", 쌍점으로 나눈 것, Base64 로 적은 것도 받는다. 알아볼 수 없으면 null.
 */
export function normalizeChecksum(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^(md5|sha-?1|sha-?256|sha-?384|sha-?512|crc-?32)\s*[:=(-]\s*/i, '').replace(/\)$/, '');
  // sha256sum 출력: "해시  파일이름"
  const first = s.split(/\s+/)[0];
  const hex = first.replace(/^0x/i, '').replace(/[:-]/g, '');
  if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0 && hashByHexLength(hex.length)) return hex.toLowerCase();
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(first)) {
    const bytes = base64Decode(first);
    if (bytes && hashByHexLength(bytes.length * 2)) return hexEncode(bytes);
  }
  return null;
}
