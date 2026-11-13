// 식별자: UUID · ULID · ObjectId 읽기와 만들기, 무작위 토큰 · 비밀번호.

import { randomInt, type RandomSource } from '../raffle/core';
import { base64Encode, hexEncode } from './codec';

/** 바이트를 무작위로 채우는 함수 (시험에서는 정해진 값을 넣는다) */
export type ByteSource = (buf: Uint8Array) => void;
const cryptoBytes: ByteSource = (buf) => {
  crypto.getRandomValues(buf);
};
// randomInt 는 32비트 수를 받는다 — 바이트 넷으로 하나를 만든다
const asUint32 = (bytes: ByteSource): RandomSource => (buf) => {
  const b = new Uint8Array(buf.length * 4);
  bytes(b);
  for (let i = 0; i < buf.length; i++) buf[i] = ((b[i * 4] << 24) | (b[i * 4 + 1] << 16) | (b[i * 4 + 2] << 8) | b[i * 4 + 3]) >>> 0;
};

// ── UUID ──
export interface UuidInfo {
  /** 소문자, 줄표 넣은 꼴 */
  canonical: string;
  version: number;
  variant: 'RFC 4122' | 'NCS (옛 방식)' | 'Microsoft' | '예약됨';
  /** v1 · v6 · v7 에 들어 있는 만든 시각 (ms) */
  time: number | null;
  nil: boolean;
  max: boolean;
}

const UUID_RE = /^(?:urn:uuid:)?\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/i;
/** 1582-10-15 부터 1970-01-01 까지, 100나노초 단위 */
const GREGORIAN = 0x01b21dd213814000n;

export const UUID_VERSION_NOTE: Record<number, string> = {
  1: '시각 + 기기 주소 (MAC) 로 만든 것',
  2: 'DCE 보안용',
  3: '이름을 MD5 로 해시해 만든 것',
  4: '무작위로 만든 것',
  5: '이름을 SHA-1 로 해시해 만든 것',
  6: '시각 순으로 줄 서는 v1',
  7: '시각(밀리초) + 무작위 — 만든 순서대로 줄 섭니다',
  8: '만든 쪽이 정한 꼴',
};

export function parseUuid(input: string): UuidInfo | null {
  const m = UUID_RE.exec(input.trim());
  if (!m) return null;
  const hex = m.slice(1).join('').toLowerCase();
  const canonical = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const version = parseInt(hex[12], 16);
  const v = parseInt(hex[16], 16);
  const variant = v < 8 ? 'NCS (옛 방식)' : v < 12 ? 'RFC 4122' : v < 14 ? 'Microsoft' : '예약됨';
  let time: number | null = null;
  if (variant === 'RFC 4122') {
    if (version === 7) time = parseInt(hex.slice(0, 12), 16);
    else if (version === 1 || version === 6) {
      const ticks = version === 1 ? BigInt('0x' + hex.slice(13, 16) + hex.slice(8, 12) + hex.slice(0, 8)) : BigInt('0x' + hex.slice(0, 12) + hex.slice(13, 16));
      time = Number((ticks - GREGORIAN) / 10000n);
    }
  }
  return { canonical, version, variant, time, nil: /^0+$/.test(hex), max: /^f+$/.test(hex) };
}

function formatUuid(b: Uint8Array): string {
  const h = hexEncode(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function uuidV4(rand: ByteSource = cryptoBytes): string {
  const b = new Uint8Array(16);
  rand(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUuid(b);
}

export function uuidV7(now = Date.now(), rand: ByteSource = cryptoBytes): string {
  const b = new Uint8Array(16);
  rand(b);
  // 앞 48비트가 밀리초 시각
  for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 255;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUuid(b);
}

// ── ULID ──
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

/** ULID 에 든 만든 시각 (ms). ULID 꼴이 아니면 null */
export function parseUlid(input: string): { time: number; canonical: string } | null {
  const s = input.trim();
  if (!ULID_RE.test(s)) return null;
  const canonical = s.toUpperCase();
  let time = 0;
  for (let i = 0; i < 10; i++) time = time * 32 + CROCKFORD.indexOf(canonical[i]);
  return { time, canonical };
}

export function ulid(now = Date.now(), rand: ByteSource = cryptoBytes): string {
  let head = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[t % 32] + head;
    t = Math.floor(t / 32);
  }
  // 무작위 80비트 = 10바이트 → 5비트씩 16글자
  const b = new Uint8Array(10);
  rand(b);
  let tail = '';
  let acc = 0;
  let bits = 0;
  for (const byte of b) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      tail += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return head + tail;
}

// ── MongoDB ObjectId ──
export function parseObjectId(input: string): { time: number; counter: number } | null {
  const s = input.trim();
  if (!/^[0-9a-f]{24}$/i.test(s)) return null;
  return { time: parseInt(s.slice(0, 8), 16) * 1000, counter: parseInt(s.slice(18), 16) };
}

// ── 무작위 토큰 ──
export type TokenKind = 'hex' | 'base64url' | 'alnum';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** length 글자짜리 토큰. 16 · 64 는 256 을 나누어떨어뜨리므로 바이트를 그대로 써도 치우치지 않는다 */
export function token(length: number, kind: TokenKind, rand: ByteSource = cryptoBytes): string {
  const n = Math.max(1, Math.floor(length));
  if (kind === 'alnum') return pickChars(ALNUM, n, rand);
  const bytes = new Uint8Array(kind === 'hex' ? Math.ceil(n / 2) : Math.ceil((n * 3) / 4));
  rand(bytes);
  return (kind === 'hex' ? hexEncode(bytes) : base64Encode(bytes, { url: true })).slice(0, n);
}

function pickChars(pool: string, n: number, rand: ByteSource): string {
  const src = asUint32(rand);
  let out = '';
  for (let i = 0; i < n; i++) out += pool[randomInt(pool.length, src)];
  return out;
}

/** 글자 하나에 담기는 비트 수 × 길이 */
export function tokenBits(length: number, kind: TokenKind): number {
  return length * (kind === 'hex' ? 4 : kind === 'base64url' ? 6 : Math.log2(62));
}

// ── 비밀번호 ──
export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  /** 헷갈리는 글자(0 O 1 l I)를 뺀다 */
  noAmbiguous: boolean;
}

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*-_=+?',
};
export const AMBIGUOUS = '0O1lI';

/** 고른 글자 묶음들 (헷갈리는 글자를 뺀 뒤). 아무것도 고르지 않았으면 빈 배열 */
export function passwordSets(o: PasswordOptions): string[] {
  const sets: string[] = [];
  for (const key of ['lower', 'upper', 'digits', 'symbols'] as const) {
    if (!o[key]) continue;
    sets.push(o.noAmbiguous ? [...SETS[key]].filter((c) => !AMBIGUOUS.includes(c)).join('') : SETS[key]);
  }
  return sets;
}

/**
 * 고른 묶음마다 적어도 한 글자씩 들어간 비밀번호. 조건에 맞지 않으면 통째로 다시 뽑는다
 * (자리를 정해 끼워 넣지 않으므로 조건에 맞는 것들 사이에서는 고르다).
 */
export function password(o: PasswordOptions, rand: ByteSource = cryptoBytes): string {
  const sets = passwordSets(o);
  if (!sets.length) return '';
  const pool = sets.join('');
  const n = Math.max(1, Math.floor(o.length));
  for (let tries = 0; ; tries++) {
    const pw = pickChars(pool, n, rand);
    if (n < sets.length || tries > 200 || sets.every((s) => [...pw].some((c) => s.includes(c)))) return pw;
  }
}

export function passwordBits(o: PasswordOptions): number {
  const pool = passwordSets(o).join('').length;
  return pool ? Math.max(1, Math.floor(o.length)) * Math.log2(pool) : 0;
}

/** 엔트로피(비트)를 보통 말로 */
export function strengthNote(bits: number): { level: 0 | 1 | 2 | 3; label: string; note: string } {
  if (bits < 40) return { level: 0, label: '약함', note: '금방 뚫릴 수 있습니다. 더 길게 만드세요.' };
  if (bits < 60) return { level: 1, label: '보통', note: '온라인 로그인에는 쓸 만하지만, 유출된 해시를 맞혀 보는 공격에는 약합니다.' };
  if (bits < 90) return { level: 2, label: '튼튼함', note: '웬만한 공격으로는 뚫기 어렵습니다.' };
  return { level: 3, label: '아주 튼튼함', note: '지금 기술로는 다 맞혀 볼 수 없는 길이입니다.' };
}
