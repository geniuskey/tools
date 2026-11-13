// 바이트 ↔ 글 변환 모음: UTF-8, Base64, 16진수, URL, HTML 엔티티, \u 이스케이프, quoted-printable, 깨진 글 되살리기.
// 모두 순수 함수라 Node 에서도 그대로 돈다.

import { toAscii } from './punycode';

// ── UTF-8 ──
const encoder = new TextEncoder();

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/** 올바른 UTF-8 이 아니면 null */
export function utf8Decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** 다른 글자 집합(EUC-KR 등)으로 읽는다. 브라우저가 모르는 이름이거나 맞지 않으면 null */
export function decodeAs(bytes: Uint8Array, charset: string): string | null {
  try {
    return new TextDecoder(charset, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** 사람이 읽을 글인가 — 줄바꿈 · 탭 말고는 제어 문자가 없어야 한다 */
export function isReadable(text: string): boolean {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f�]/.test(text);
}

// ── Base64 ──
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_REV = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) {
  B64_REV[B64.charCodeAt(i)] = i;
  B64_REV[B64URL.charCodeAt(i)] = i;
}

export function base64Encode(bytes: Uint8Array, opts: { url?: boolean; pad?: boolean } = {}): string {
  const abc = opts.url ? B64URL : B64;
  const pad = opts.pad ?? !opts.url;
  const parts: string[] = [];
  let chunk = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i];
    const b = i + 1 < n ? bytes[i + 1] : 0;
    const c = i + 2 < n ? bytes[i + 2] : 0;
    chunk += abc[a >> 2] + abc[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < n) chunk += abc[((b & 15) << 2) | (c >> 6)];
    else if (pad) chunk += '=';
    if (i + 2 < n) chunk += abc[c & 63];
    else if (pad) chunk += '=';
    // 큰 파일에서 문자열 하나를 계속 늘리지 않게 끊어 모은다
    if (chunk.length > 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
  return parts.join('');
}

/**
 * Base64 · Base64URL 을 바이트로. 공백과 줄바꿈은 건너뛰고, 빠진 = 는 채워 읽는다.
 * 쓸 수 없는 글자가 있거나 길이가 맞지 않으면 null.
 */
export function base64Decode(input: string): Uint8Array | null {
  let len = 0;
  let end = input.length;
  // 뒤쪽 공백과 = 를 떼어 낸다
  let pads = 0;
  while (end > 0) {
    const c = input.charCodeAt(end - 1);
    if (c === 61) pads++;
    else if (!(c === 32 || (c >= 9 && c <= 13))) break;
    end--;
  }
  if (pads > 2) return null;
  for (let i = 0; i < end; i++) {
    const c = input.charCodeAt(i);
    if (c === 32 || (c >= 9 && c <= 13)) continue;
    if (c > 127 || B64_REV[c] < 0) return null;
    len++;
  }
  const rem = len % 4;
  if (rem === 1) return null;
  if (pads && (len + pads) % 4 !== 0) return null;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < end; i++) {
    const c = input.charCodeAt(i);
    if (c === 32 || (c >= 9 && c <= 13)) continue;
    acc = ((acc << 6) | B64_REV[c]) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out;
}

// ── 16진수 ──
const HEX = '0123456789abcdef';

export function hexEncode(bytes: Uint8Array, sep = ''): string {
  const parts: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) parts[i] = HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return parts.join(sep);
}

/** 0x · \x · 공백 · 쉼표 · 쌍점을 걷어 내고 읽는다. 16진수가 아니거나 홀수 자리면 null */
export function hexDecode(input: string): Uint8Array | null {
  const clean = input.replace(/\\x|0x|[\s,:;-]/gi, '');
  if (!clean || clean.length % 2 || !/^[0-9a-f]+$/i.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 한 줄에 16바이트씩: 위치 · 16진수 · 글자 */
export function hexDump(bytes: Uint8Array, limit = 256): string {
  const n = Math.min(bytes.length, limit);
  const lines: string[] = [];
  for (let off = 0; off < n; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, n));
    let hex = '';
    let chars = '';
    for (let i = 0; i < 16; i++) {
      hex += i < row.length ? HEX[row[i] >> 4] + HEX[row[i] & 15] + ' ' : '   ';
      if (i === 7) hex += ' ';
      if (i < row.length) chars += row[i] >= 32 && row[i] < 127 ? String.fromCharCode(row[i]) : '.';
    }
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex} ${chars}`);
  }
  return lines.join('\n');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n.toLocaleString('ko-KR')}바이트`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)}MB`;
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}

// ── 파일 종류 (앞머리 바이트로 알아본다) ──
export interface FileType {
  name: string;
  ext: string;
  mime: string;
  image?: boolean;
}

const MAGIC: [number[], number, FileType][] = [
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0, { name: 'PNG 이미지', ext: 'png', mime: 'image/png', image: true }],
  [[0xff, 0xd8, 0xff], 0, { name: 'JPEG 이미지', ext: 'jpg', mime: 'image/jpeg', image: true }],
  [[0x47, 0x49, 0x46, 0x38], 0, { name: 'GIF 이미지', ext: 'gif', mime: 'image/gif', image: true }],
  [[0x57, 0x45, 0x42, 0x50], 8, { name: 'WebP 이미지', ext: 'webp', mime: 'image/webp', image: true }],
  [[0x42, 0x4d], 0, { name: 'BMP 이미지', ext: 'bmp', mime: 'image/bmp', image: true }],
  [[0x00, 0x00, 0x01, 0x00], 0, { name: '아이콘(ICO)', ext: 'ico', mime: 'image/x-icon', image: true }],
  [[0x25, 0x50, 0x44, 0x46, 0x2d], 0, { name: 'PDF 문서', ext: 'pdf', mime: 'application/pdf' }],
  [[0x50, 0x4b, 0x03, 0x04], 0, { name: 'ZIP 묶음 (docx · xlsx · jar 도 ZIP 입니다)', ext: 'zip', mime: 'application/zip' }],
  [[0x1f, 0x8b, 0x08], 0, { name: 'gzip 압축', ext: 'gz', mime: 'application/gzip' }],
  [[0x42, 0x5a, 0x68], 0, { name: 'bzip2 압축', ext: 'bz2', mime: 'application/x-bzip2' }],
  [[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], 0, { name: 'xz 압축', ext: 'xz', mime: 'application/x-xz' }],
  [[0x28, 0xb5, 0x2f, 0xfd], 0, { name: 'zstd 압축', ext: 'zst', mime: 'application/zstd' }],
  [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], 0, { name: '7z 묶음', ext: '7z', mime: 'application/x-7z-compressed' }],
  [[0x00, 0x61, 0x73, 0x6d], 0, { name: 'WebAssembly', ext: 'wasm', mime: 'application/wasm' }],
  [[0x66, 0x74, 0x79, 0x70], 4, { name: 'MP4 영상', ext: 'mp4', mime: 'video/mp4' }],
  [[0x49, 0x44, 0x33], 0, { name: 'MP3 소리', ext: 'mp3', mime: 'audio/mpeg' }],
  [[0x4f, 0x67, 0x67, 0x53], 0, { name: 'Ogg', ext: 'ogg', mime: 'audio/ogg' }],
  [[0x77, 0x4f, 0x46, 0x32], 0, { name: 'WOFF2 글꼴', ext: 'woff2', mime: 'font/woff2' }],
  [[0x77, 0x4f, 0x46, 0x46], 0, { name: 'WOFF 글꼴', ext: 'woff', mime: 'font/woff' }],
  [[0x7f, 0x45, 0x4c, 0x46], 0, { name: 'ELF 실행 파일', ext: 'elf', mime: 'application/octet-stream' }],
  [[0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00], 0, { name: 'SQLite 데이터베이스', ext: 'sqlite', mime: 'application/vnd.sqlite3' }],
];

export function sniff(bytes: Uint8Array): FileType | null {
  for (const [sig, at, type] of MAGIC) {
    if (bytes.length < at + sig.length) continue;
    let ok = true;
    for (let i = 0; i < sig.length && ok; i++) ok = bytes[at + i] === sig[i];
    // BMP · ICO 는 앞머리가 짧아 조금 더 본다
    if (ok && type.ext === 'bmp' && bytes.length < 26) ok = false;
    if (ok && type.ext === 'ico' && (bytes.length < 22 || bytes[4] === 0)) ok = false;
    if (ok) return type;
  }
  return null;
}

/** gzip 을 푼다. 브라우저가 DecompressionStream 을 모르거나 내용이 깨졌으면 null */
export async function gunzip(bytes: Uint8Array, limit = 32 * 1024 * 1024): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      // 압축 폭탄에 당하지 않게 끊는다
      if (total > limit) {
        await reader.cancel();
        break;
      }
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  } catch {
    return null;
  }
}

// ── URL (퍼센트 인코딩) ──
/** %XX 를 바이트로 되돌린다. % 뒤가 16진수 두 자리가 아니면 null */
export function percentBytes(input: string, plusAsSpace = false): Uint8Array | null {
  const src = utf8Encode(input);
  const out = new Uint8Array(src.length);
  let o = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === 37) {
      const hi = hexVal(src[i + 1]);
      const lo = hexVal(src[i + 2]);
      if (hi < 0 || lo < 0) return null;
      out[o++] = (hi << 4) | lo;
      i += 2;
    } else out[o++] = plusAsSpace && c === 43 ? 32 : c;
  }
  return out.subarray(0, o);
}
function hexVal(c: number | undefined): number {
  if (c === undefined) return -1;
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}

export interface PercentResult {
  text: string;
  /** UTF-8 이 아니어서 다른 글자 집합으로 읽었으면 그 이름 */
  charset: 'utf-8' | 'euc-kr';
}

/** 퍼센트 인코딩을 푼다. UTF-8 이 아니면 EUC-KR 로도 읽어 본다 (옛 한국 사이트 주소) */
export function percentDecode(input: string, plusAsSpace = false): PercentResult | null {
  const bytes = percentBytes(input, plusAsSpace);
  if (!bytes) return null;
  const text = utf8Decode(bytes);
  if (text != null) return { text, charset: 'utf-8' };
  const kr = decodeAs(bytes, 'euc-kr');
  return kr != null ? { text: kr, charset: 'euc-kr' } : null;
}

/** 풀고 난 글에 %XX 가 또 남아 있고 그것도 풀리는가 */
export function isDoubleEncoded(decoded: string): boolean {
  if (!/%[0-9a-f]{2}/i.test(decoded)) return false;
  const again = percentDecode(decoded);
  return again != null && again.text !== decoded;
}

/** 짝 없는 서로게이트가 있어도 던지지 않는 encodeURIComponent */
export function urlEncode(text: string, full = false): string {
  const safe = text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
  return full ? encodeURI(safe) : encodeURIComponent(safe);
}

// ── HTML 엔티티 ──
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
  bull: '•', middot: '·', times: '×', divide: '÷', deg: '°', plusmn: '±', micro: 'µ', para: '¶', sect: '§',
  euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', lArr: '⇐', rArr: '⇒', hArr: '⇔',
  hearts: '♥', spades: '♠', clubs: '♣', diams: '♦', check: '✓', star: '☆', starf: '★',
  le: '≤', ge: '≥', ne: '≠', asymp: '≈', equiv: '≡', infin: '∞', sum: '∑', prod: '∏', radic: '√', part: '∂',
  minus: '−', lowast: '∗', prime: '′', Prime: '″', permil: '‰', dagger: '†', Dagger: '‡', loz: '◊',
  frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³', ordf: 'ª', ordm: 'º',
  iexcl: '¡', iquest: '¿', szlig: 'ß', shy: '­', ensp: ' ', emsp: ' ', thinsp: ' ',
  zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏', tilde: '˜', circ: 'ˆ', acute: '´', cedil: '¸', uml: '¨',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', tau: 'τ',
  phi: 'φ', omega: 'ω', theta: 'θ', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', Pi: 'Π',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', egrave: 'è', ograve: 'ò',
  auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', acirc: 'â', ecirc: 'ê', ocirc: 'ô', ccedil: 'ç', ntilde: 'ñ',
  Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', Eacute: 'É', Ccedil: 'Ç', Ntilde: 'Ñ', aring: 'å', Aring: 'Å', oslash: 'ø', aelig: 'æ',
};

export const ENTITY_RE = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,10});/g;

/** 엔티티를 글자로. 모르는 이름은 그대로 둔다. count 는 바꾼 개수 */
export function htmlDecode(input: string): { text: string; count: number } {
  let count = 0;
  const text = input.replace(ENTITY_RE, (all, body: string) => {
    let ch: string | undefined;
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) ch = String.fromCodePoint(code);
    } else ch = NAMED[body];
    if (ch === undefined) return all;
    count++;
    return ch;
  });
  return { text, count };
}

/** all 이면 영문 · 숫자 밖의 글자를 모두 &#x…; 로 */
export function htmlEncode(text: string, all = false): string {
  const basic = text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  if (!all) return basic;
  return Array.from(basic, (ch) => (ch.codePointAt(0)! > 126 ? `&#x${ch.codePointAt(0)!.toString(16).toUpperCase()};` : ch)).join('');
}

// ── JS · JSON 이스케이프 ──
export const ESCAPE_RE = /\\(u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[nrtbfv0'"\\/])/g;
const SIMPLE: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', "'": "'", '"': '"', '\\': '\\', '/': '/' };

/** \uXXXX · \u{…} · \xHH · \n 따위를 글자로. unicode 는 그중 \u · \x 의 개수 */
export function unescapeJs(input: string): { text: string; count: number; unicode: number } {
  let count = 0;
  let unicode = 0;
  const text = input.replace(ESCAPE_RE, (all, body: string) => {
    count++;
    if (body[0] === 'u' || body[0] === 'x') {
      const code = parseInt(body.replace(/^[ux]\{?|\}$/g, ''), 16);
      if (code > 0x10ffff) {
        count--;
        return all;
      }
      unicode++;
      // 😀 처럼 둘로 나뉜 것은 이어 붙으면 한 글자가 된다
      return code > 0xffff ? String.fromCodePoint(code) : String.fromCharCode(code);
    }
    return SIMPLE[body];
  });
  return { text, count, unicode };
}

/** ASCII 밖의 글자를 \uXXXX 로 (이모지는 서로게이트 두 개로 — JSON 에서도 쓸 수 있다) */
export function escapeUnicode(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 126) out += '\\u' + c.toString(16).padStart(4, '0');
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c === 92) out += '\\\\';
    else if (c < 32) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += text[i];
  }
  return out;
}

// ── quoted-printable · MIME 머리글 ──
/** =XX 와 줄 끝 = (이어 쓰기)를 푼다. 꼴이 맞지 않으면 null */
export function qpBytes(input: string, underscoreAsSpace = false): Uint8Array | null {
  const src = utf8Encode(input);
  const out = new Uint8Array(src.length);
  let o = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === 61) {
      if (src[i + 1] === 13 && src[i + 2] === 10) i += 2;
      else if (src[i + 1] === 10) i += 1;
      else {
        const hi = hexVal(src[i + 1]);
        const lo = hexVal(src[i + 2]);
        if (hi < 0 || lo < 0) return null;
        out[o++] = (hi << 4) | lo;
        i += 2;
      }
    } else out[o++] = underscoreAsSpace && c === 95 ? 32 : c;
  }
  return out.subarray(0, o);
}

export const MIME_WORD_RE = /=\?([A-Za-z0-9_-]+)\?([BbQq])\?([^?\s]*)\?=/g;

/** =?UTF-8?B?…?= 꼴(메일 제목)을 푼다. 하나도 못 풀면 null */
export function mimeWordDecode(input: string): { text: string; charsets: string[] } | null {
  const charsets: string[] = [];
  let failed = false;
  // 이어진 조각 사이의 공백은 버린다 (RFC 2047)
  const joined = input.replace(/(\?=)\s+(?==\?[A-Za-z0-9_-]+\?[BbQq]\?)/g, '$1');
  const text = joined.replace(MIME_WORD_RE, (all, charset: string, enc: string, body: string) => {
    const bytes = enc.toUpperCase() === 'B' ? base64Decode(body) : qpBytes(body, true);
    const decoded = bytes && decodeAs(bytes, charset);
    if (decoded == null) {
      failed = true;
      return all;
    }
    if (!charsets.includes(charset.toUpperCase())) charsets.push(charset.toUpperCase());
    return decoded;
  });
  return charsets.length && !failed ? { text, charsets } : null;
}

// ── 깨진 글 (UTF-8 을 Latin-1 · CP1252 로 잘못 읽은 것) ──
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const CP1252_REV = new Map<number, number>();
for (let i = 0; i < CP1252.length; i++) CP1252_REV.set(CP1252.charCodeAt(i), 0x80 + i);

/** ê°€ → 가. 되살릴 수 없으면 null */
export function fixMojibake(input: string): string | null {
  // 깨진 글에는 Ã Â ê ë ì í 같은 글자 뒤에 기호가 따라온다
  if (!/[Â-ô]/.test(input)) return null;
  const bytes = new Uint8Array(input.length);
  let high = 0;
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c > 0xff) {
      const b = CP1252_REV.get(c);
      if (b === undefined) return null;
      c = b;
    }
    if (c >= 0x80) high++;
    bytes[i] = c;
  }
  if (high < 2) return null;
  const text = utf8Decode(bytes);
  if (text == null || text === input || !isReadable(text)) return null;
  return text;
}

// ── 만들기: 한 번에 모든 꼴로 ──
export interface Encoded {
  id: string;
  label: string;
  value: string;
  hint?: string;
}

export function encodeAll(text: string): Encoded[] {
  const bytes = utf8Encode(text);
  const rows: Encoded[] = [
    { id: 'base64', label: 'Base64', value: base64Encode(bytes) },
    { id: 'base64url', label: 'Base64URL', value: base64Encode(bytes, { url: true }), hint: '주소 · 파일 이름에 넣어도 되는 꼴 (+ / 대신 - _, = 없음)' },
    { id: 'url', label: 'URL (값 하나)', value: urlEncode(text), hint: '쿼리 값으로 넣을 때 — & = / ? 도 바꿉니다' },
    { id: 'urlfull', label: 'URL (주소 통째로)', value: urlEncode(text, true), hint: '주소 전체일 때 — : / ? & = 는 그대로 둡니다' },
    { id: 'hex', label: '16진수', value: hexEncode(bytes) },
    { id: 'html', label: 'HTML 엔티티', value: htmlEncode(text), hint: '& < > " \' 만 바꿉니다' },
    { id: 'htmlnum', label: 'HTML 숫자 엔티티', value: htmlEncode(text, true), hint: '한글 · 기호까지 모두 &#x…; 로' },
    { id: 'unicode', label: '\\u 이스케이프', value: escapeUnicode(text) },
    { id: 'json', label: 'JSON 문자열', value: JSON.stringify(text) },
  ];
  const domain = text.trim();
  if (/[^\x00-\x7f]/.test(domain) && /^[^\s/?#@:]+(\.[^\s/?#@:]+)+$/.test(domain)) {
    const ascii = toAscii(domain);
    if (ascii) rows.push({ id: 'punycode', label: 'Punycode (도메인)', value: ascii, hint: '한글 도메인을 영문 · 숫자만으로 적은 꼴' });
  }
  return rows;
}

/** 글자 수(눈에 보이는 글자 기준에 가깝게 코드 포인트로)와 UTF-8 바이트 */
export function textStats(text: string): { chars: number; bytes: number; lines: number } {
  let chars = 0;
  for (const _ of text) chars++;
  return { chars, bytes: utf8Encode(text).length, lines: text ? text.split('\n').length : 0 };
}
