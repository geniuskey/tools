// 붙여넣은 글이 무엇인지 알아본다. 그럴듯한 읽기를 모두 내고, 확실한 것부터 줄 세운다.

import {
  ENTITY_RE,
  MIME_WORD_RE,
  base64Decode,
  decodeAs,
  fixMojibake,
  hexDecode,
  htmlDecode,
  isDoubleEncoded,
  isReadable,
  mimeWordDecode,
  percentBytes,
  percentDecode,
  qpBytes,
  sniff,
  unescapeJs,
  utf8Decode,
  type FileType,
} from './codec';
import { hashByHexLength } from './hash';
import { UUID_VERSION_NOTE, parseObjectId, parseUlid, parseUuid } from './ids';
import { parseJwt, type Jwt } from './jwt';
import { toAscii, toUnicode } from './punycode';
import { UNIT_NAME, guessUnix, kst, parseDate, relative, utcIso } from './time';

export type Kind =
  | 'jwt'
  | 'base64'
  | 'base64url'
  | 'url'
  | 'percent'
  | 'datauri'
  | 'hex'
  | 'html'
  | 'escape'
  | 'qp'
  | 'mime'
  | 'punycode'
  | 'unix'
  | 'date'
  | 'uuid'
  | 'ulid'
  | 'objectid'
  | 'hash'
  | 'mojibake'
  | 'json';

export interface Row {
  label: string;
  value: string;
  note?: string;
  tone?: 'bad' | 'ok';
  /** 이 값을 새 입력으로 넣어 다시 풀어 볼 만한가 */
  again?: boolean;
}

export interface Note {
  text: string;
  tone?: 'bad' | 'warn';
}

export interface Candidate {
  kind: Kind;
  title: string;
  /** 0 ~ 1. 0.9 이상은 거의 확실, 0.6 이상은 그럴듯함 */
  confidence: number;
  /** 왜 그렇게 보았는지 한 줄 */
  reason: string;
  /** 풀어낸 글 */
  text?: string;
  /** text 가 JSON 이라 보기 좋게 줄을 나눈 것인가 */
  json?: boolean;
  /** 글이 아닌 내용 (파일 · 바이트) */
  bytes?: Uint8Array;
  file?: FileType;
  rows?: Row[];
  notes?: Note[];
  jwt?: Jwt;
  /** text 를 다시 풀어 볼 만한가 (겹겹이 싸인 인코딩) */
  again?: boolean;
}

/** 이보다 긴 JSON 은 줄을 나누지 않는다 */
const JSON_MAX = 2_000_000;

function prettyJson(text: string): string | null {
  const t = text.trim();
  if (t.length > JSON_MAX || !/^[[{]/.test(t) || !/[\]}]$/.test(t)) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

/** 풀어낸 바이트를 글 · JSON · 파일 가운데 무엇으로 보여 줄지 정한다 */
export function payload(bytes: Uint8Array): Pick<Candidate, 'text' | 'json' | 'bytes' | 'file' | 'again'> {
  const file = sniff(bytes);
  if (!file) {
    const text = utf8Decode(bytes);
    if (text != null && isReadable(text)) return asText(text);
  }
  return { bytes, file: file ?? undefined };
}
function asText(text: string): Pick<Candidate, 'text' | 'json' | 'again'> {
  const pretty = prettyJson(text);
  return pretty != null ? { text: pretty, json: true, again: false } : { text, again: true };
}

const n = (v: number) => v.toLocaleString('ko-KR');

function timeRows(ms: number, now: number): Row[] {
  return [
    { label: '한국 시간', value: kst(ms), note: relative(ms, now) },
    { label: 'UTC', value: utcIso(ms) },
  ];
}

// ── 하나씩 ──
function detectJwt(s: string): Candidate | null {
  if (s.length > 100_000) return null;
  const jwt = parseJwt(s);
  if (!jwt) return null;
  const notes: Note[] = [];
  if (/^none$/i.test(jwt.alg)) notes.push({ tone: 'bad', text: 'alg 가 none 입니다 — 서명이 없어 누구나 내용을 바꿔 만들 수 있습니다. 이런 토큰을 받아 주면 안 됩니다.' });
  else if (!jwt.signature.length) notes.push({ tone: 'warn', text: '서명 토막이 비어 있습니다.' });
  return { kind: 'jwt', title: 'JWT', confidence: 0.99, reason: '점 두 개로 나뉜 Base64URL 세 토막 — JWT 로 보입니다', text: jwt.payloadJson, jwt, notes };
}

function detectBase64(s: string): Candidate | null {
  if (s.length < 4) return null;
  let body = s;
  if (/\s/.test(s)) {
    // 줄을 나눠 적은 Base64 (메일 · PEM) 만 받는다 — 낱말 사이의 공백과 헷갈리지 않게
    const lines = s.split(/\s+/);
    const width = lines[0].length;
    if (width < 16 || !lines.slice(0, -1).every((l) => l.length === width) || lines[lines.length - 1].length > width) return null;
    body = lines.join('');
  }
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(body) || /^\d+$/.test(body)) return null;
  const url = /[-_]/.test(body);
  const std = /[+/]/.test(body);
  if (url && std) return null;
  const bytes = base64Decode(body);
  if (!bytes || !bytes.length) return null;

  const padded = body.endsWith('=');
  const p = payload(bytes);
  const notes: Note[] = [];
  if (!padded && body.length % 4) notes.push({ text: '끝의 = 채움 글자가 빠져 있어 채워서 읽었습니다.' });
  let confidence: number;
  let reason: string;
  const name = url ? 'Base64URL' : 'Base64';
  const alphabet = url ? 'A–Z a–z 0–9 - _' : 'A–Z a–z 0–9 + /';
  if (p.file) {
    confidence = 0.92;
    reason = `${name} 로 풀어 보니 앞머리가 ${p.file.name.replace(/ \(.*/, '')}입니다`;
  } else if (p.text != null) {
    confidence = body.length >= 8 ? 0.9 : 0.55;
    // 영문 낱말이 우연히 풀린 것일 수 있다
    if (/^[A-Za-z]+$/.test(body) && body.length < 12 && /[^\x20-\x7e\s]/.test(p.text)) confidence = 0.3;
    reason = p.json ? `${name} 글자(${alphabet})로만 되어 있고, 풀면 JSON 이 나옵니다` : `${name} 글자(${alphabet})로만 되어 있고, 풀면 읽을 수 있는 글이 나옵니다`;
  } else {
    const mixed = /\d/.test(body) && /[a-z]/.test(body) && /[A-Z]/.test(body);
    confidence = padded || std || url ? 0.5 : mixed && body.length >= 16 ? 0.45 : 0.15;
    reason = `${name} 로 풀리지만 글은 아닙니다 — 바이트로 보여 줍니다`;
    const hash = hashByHexLength(bytes.length * 2);
    if (hash && bytes.length >= 16) notes.push({ text: `${bytes.length}바이트 — ${hash} 해시를 Base64 로 적은 것일 수 있습니다.` });
  }
  // 16진수로도 읽히면 그쪽이 먼저다
  if (/^[0-9a-fA-F]+$/.test(body)) confidence = Math.min(confidence, 0.25);
  return { kind: url ? 'base64url' : 'base64', title: name, confidence, reason, notes, ...p };
}

function queryRows(query: string): Row[] {
  const rows: Row[] = [];
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    const rawValue = eq < 0 ? '' : part.slice(eq + 1);
    const key = percentDecode(rawKey, true)?.text ?? rawKey;
    const value = percentDecode(rawValue, true);
    const row: Row = { label: key, value: value?.text ?? rawValue };
    if (!value) row.note = '퍼센트 인코딩이 깨져 있어 그대로 둡니다';
    else if (isDoubleEncoded(value.text)) row.note = '두 번 인코딩되어 있습니다 — 한 번 더 풀어야 합니다';
    else if (value.charset === 'euc-kr') row.note = 'EUC-KR 로 읽었습니다';
    row.again = row.value.length >= 4;
    rows.push(row);
    if (rows.length >= 200) break;
  }
  return rows;
}

function detectUrl(s: string): Candidate | null {
  if (s.length > 200_000 || !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const rows: Row[] = [{ label: '프로토콜', value: u.protocol.replace(/:$/, '') }];
  const notes: Note[] = [];
  if (u.username || u.password) {
    rows.push({ label: '사용자', value: u.password ? `${decodeURIComponentSafe(u.username)} (비밀번호 있음)` : decodeURIComponentSafe(u.username) });
    notes.push({ tone: 'warn', text: '주소 안에 아이디 · 비밀번호가 들어 있습니다. 남에게 보낼 때 조심하세요.' });
  }
  const uni = toUnicode(u.hostname);
  rows.push({ label: '호스트', value: uni ?? u.hostname, note: uni ? `Punycode 로는 ${u.hostname}` : undefined });
  if (u.port) rows.push({ label: '포트', value: u.port });
  if (u.pathname && u.pathname !== '/') {
    const path = percentDecode(u.pathname);
    rows.push({ label: '경로', value: path?.text ?? u.pathname, note: path?.charset === 'euc-kr' ? 'EUC-KR 로 읽었습니다' : undefined });
  }
  const params = u.search.length > 1 ? queryRows(u.search.slice(1)) : [];
  const fragment = u.hash.length > 1 ? (percentDecode(u.hash.slice(1))?.text ?? u.hash.slice(1)) : '';
  if (params.some((r) => r.note?.startsWith('두 번'))) notes.push({ tone: 'warn', text: '두 번 인코딩된 값이 있습니다. 그 값의 "다시 풀기" 를 눌러 한 번 더 풀어 보세요.' });
  const decoded = percentDecode(s)?.text;
  const changed = decoded != null && decoded !== s;
  return {
    kind: 'url',
    title: '주소 (URL)',
    confidence: 0.97,
    reason: changed ? '프로토콜://호스트 꼴 — 주소입니다. 퍼센트 인코딩을 풀고 부분별로 나눴습니다' : '프로토콜://호스트 꼴 — 주소입니다. 부분별로 나눴습니다',
    text: changed ? decoded : undefined,
    rows: [...rows, ...params.map((r) => ({ ...r, label: `?${r.label}` })), ...(fragment ? [{ label: '# 조각', value: fragment, again: fragment.length >= 4 }] : [])],
    notes,
    again: false,
  };
}
function decodeURIComponentSafe(v: string): string {
  return percentDecode(v)?.text ?? v;
}

function detectPercent(s: string): Candidate | null {
  const hits = s.match(/%[0-9a-f]{2}/gi);
  if (!hits) return null;
  const queryLike = /^[^=&\s?#]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(s);
  const r = percentDecode(s, queryLike);
  if (!r || r.text === s || !isReadable(r.text)) return null;
  const notes: Note[] = [];
  if (r.charset === 'euc-kr') notes.push({ text: 'UTF-8 이 아니라 EUC-KR(옛 한글 인코딩)로 읽었습니다.' });
  const twice = isDoubleEncoded(r.text);
  if (twice) notes.push({ tone: 'warn', text: '두 번 인코딩되어 있습니다 — "이걸 다시 풀기" 로 한 번 더 풀어 보세요.' });
  return {
    kind: 'percent',
    title: 'URL 인코딩',
    confidence: hits.length >= 2 || s.length < 40 ? 0.9 : 0.6,
    reason: queryLike ? `이름=값 이 & 로 이어진 쿼리 문자열 — %XX ${n(hits.length)}곳을 풀었습니다` : `%XX 꼴 퍼센트 인코딩 ${n(hits.length)}곳을 풀었습니다`,
    rows: queryLike ? queryRows(s) : undefined,
    notes,
    ...asText(r.text),
  };
}

function detectDataUri(s: string): Candidate | null {
  const m = /^data:([^,;]*)((?:;[^,;]*)*),/i.exec(s.slice(0, 300));
  if (!m) return null;
  const isBase64 = /;base64$/i.test(m[2]);
  const body = s.slice(m[0].length);
  const bytes = isBase64 ? base64Decode(body) : percentBytes(body);
  if (!bytes) return null;
  return {
    kind: 'datauri',
    title: 'data: 주소',
    confidence: 0.97,
    reason: `data: 로 시작합니다 — 내용을 주소 안에 통째로 넣은 것입니다 (${isBase64 ? 'Base64' : '퍼센트 인코딩'})`,
    rows: [{ label: '종류', value: m[1] || 'text/plain' }],
    ...payload(bytes),
  };
}

function detectHex(s: string): Candidate | null {
  if (!/^(?:\\x|0x|[0-9a-f\s,:])+$/i.test(s)) return null;
  const marked = /\\x|0x/i.test(s);
  const separated = /[\s,:]/.test(s);
  // 표시도 없고 a–f 도 없으면 그냥 숫자다
  if (!marked && !/[a-f]/i.test(s)) return null;
  const tokens = s.split(/[\s,:]+/).filter(Boolean).map((t) => t.replace(/\\x|0x/gi, ''));
  const rows: Row[] = [];
  let clean = tokens.join('');
  // 0x1F4 처럼 수 하나면 10진수도 알려 준다
  const single = /^0x([0-9a-f]{1,16})$/i.exec(s);
  if (single) {
    rows.push({ label: '10진수', value: BigInt('0x' + single[1]).toString() });
    if (clean.length % 2) clean = '0' + clean;
  } else if (tokens.some((t) => t.length % 2)) return null;
  if (clean.length < (marked ? 2 : 4)) return null;
  const bytes = hexDecode(clean);
  if (!bytes) return null;
  const p = payload(bytes);
  let confidence: number;
  if (marked || separated) confidence = 0.9;
  else if (p.text != null || p.file) confidence = 0.85;
  else if (hashByHexLength(clean.length) && clean.length >= 32) confidence = 0.35;
  else if (clean.length === 24) confidence = 0.4;
  else confidence = 0.6;
  // dead · beef · cafe 같은 낱말
  if (!marked && !separated && /^[a-f]+$/i.test(s) && s.length <= 8) confidence = 0.3;
  const how = marked ? '0x · \\x 표시가 붙은 16진수' : separated ? '두 자리씩 나눠 적은 16진수' : '0–9 a–f 로만 된 짝수 자리 글';
  const what = p.file ? `${p.file.name.replace(/ \(.*/, '')}입니다` : p.text != null ? '글로 읽힙니다' : `${n(bytes.length)}바이트입니다`;
  return { kind: 'hex', title: '16진수', confidence, reason: `${how} — 풀면 ${what}`, rows: rows.length ? rows : undefined, ...p };
}

function detectHash(s: string): Candidate | null {
  const bcrypt = /^\$2[abxy]\$(\d\d)\$[./A-Za-z0-9]{53}$/.exec(s);
  if (bcrypt) {
    return {
      kind: 'hash',
      title: 'bcrypt 해시',
      confidence: 0.97,
      reason: '$2…$ 로 시작하는 60자 — bcrypt 비밀번호 해시입니다 (해시는 되돌릴 수 없습니다)',
      rows: [{ label: '반복', value: `2^${+bcrypt[1]} = ${n(2 ** +bcrypt[1])}번`, note: '숫자가 클수록 맞혀 보기가 오래 걸립니다' }],
    };
  }
  const argon = /^\$(argon2(?:id|i|d))\$/.exec(s);
  if (argon) return { kind: 'hash', title: 'Argon2 해시', confidence: 0.95, reason: `$${argon[1]}$ 로 시작합니다 — Argon2 비밀번호 해시입니다 (해시는 되돌릴 수 없습니다)` };
  if (s.length > 128 || !/^[0-9a-f]+$/i.test(s)) return null;
  const name = hashByHexLength(s.length);
  if (!name) return null;
  if (s.length === 8) {
    if (!/[a-f]/i.test(s)) return null;
    return { kind: 'hash', title: 'CRC32 길이', confidence: 0.35, reason: '8자 16진수 — CRC32 길이입니다 (짧아서 다른 것일 수도 있습니다)' };
  }
  const same: Record<string, string> = {
    MD5: 'NTLM · MD4 도 같은 길이입니다. 줄표를 뺀 UUID 일 수도 있습니다.',
    'SHA-1': 'git 커밋 번호도 이 길이입니다.',
    'SHA-256': 'SHA3-256 · BLAKE2s 도 같은 길이라 길이만으로는 가릴 수 없습니다.',
    'SHA-512': 'SHA3-512 · BLAKE2b 도 같은 길이입니다.',
  };
  return {
    kind: 'hash',
    title: `${name} 길이의 해시`,
    confidence: /^\d+$/.test(s) ? 0.5 : 0.8,
    reason: `${s.length}자 16진수 — ${name} 길이입니다 (해시는 되돌릴 수 없습니다)`,
    rows: [{ label: '길이', value: `${s.length / 2}바이트 (${s.length * 4}비트)` }],
    notes: [...(same[name] ? [{ text: same[name] }] : []), { text: '원래 글을 알고 있다면 "해시" 에서 만들어 맞춰 볼 수 있습니다.' }],
  };
}

function detectUuid(s: string, now: number): Candidate | null {
  if (s.length > 50) return null;
  const u = parseUuid(s);
  if (!u) return null;
  const dashed = s.includes('-');
  if (!dashed && (u.variant !== 'RFC 4122' || u.version < 1 || u.version > 8)) return null;
  const rows: Row[] = [];
  if (u.nil) rows.push({ label: '종류', value: '모두 0 — 비어 있음을 뜻하는 Nil UUID' });
  else if (u.max) rows.push({ label: '종류', value: '모두 f — Max UUID' });
  else {
    rows.push({ label: '버전', value: `v${u.version}`, note: u.variant === 'RFC 4122' ? UUID_VERSION_NOTE[u.version] : undefined });
    rows.push({ label: '변형', value: u.variant });
  }
  if (u.time != null) rows.push(...timeRows(u.time, now).map((r, i) => (i === 0 ? { ...r, label: '만든 시각' } : r)));
  if (u.canonical !== s) rows.push({ label: '표준 꼴', value: u.canonical });
  return {
    kind: 'uuid',
    title: u.nil || u.max ? 'UUID' : `UUID v${u.version}`,
    confidence: dashed ? 0.98 : 0.3,
    reason: dashed ? '8-4-4-4-12 자리 16진수 — UUID 입니다' : '32자 16진수이고 버전 · 변형 자리가 맞습니다 — 줄표를 뺀 UUID 일 수 있습니다',
    rows,
  };
}

function detectUlid(s: string, now: number): Candidate | null {
  const u = parseUlid(s);
  if (!u) return null;
  const plausible = u.time > Date.UTC(2010, 0) && u.time < now + 10 * 365 * 86400_000;
  return {
    kind: 'ulid',
    title: 'ULID',
    confidence: plausible ? 0.9 : 0.3,
    reason: plausible ? '26자 Crockford Base32 — ULID 입니다. 앞 10자가 만든 시각입니다' : '26자 Crockford Base32 — ULID 꼴이지만 시각이 어색합니다',
    rows: timeRows(u.time, now).map((r, i) => (i === 0 ? { ...r, label: '만든 시각' } : r)),
  };
}

function detectObjectId(s: string, now: number): Candidate | null {
  const o = parseObjectId(s);
  if (!o) return null;
  const plausible = o.time > Date.UTC(2009, 0) && o.time < now + 86400_000;
  return {
    kind: 'objectid',
    title: 'MongoDB ObjectId',
    confidence: plausible ? 0.75 : 0.3,
    reason: plausible ? '24자 16진수이고 앞 8자가 그럴듯한 시각입니다 — MongoDB ObjectId 로 보입니다' : '24자 16진수 — ObjectId 길이지만 시각이 어색합니다',
    rows: [...timeRows(o.time, now).map((r, i) => (i === 0 ? { ...r, label: '만든 시각' } : r)), { label: '일련번호', value: n(o.counter) }],
  };
}

function detectUnix(s: string, now: number): Candidate | null {
  const g = guessUnix(s);
  if (!g) return null;
  const digits = s.split('.')[0].length;
  const year = new Date(g.ms).getUTCFullYear();
  let confidence = g.exact ? 0.92 : 0.5;
  if (year < 2000 || year > 2100) confidence *= 0.6;
  return {
    kind: 'unix',
    title: `유닉스 시간 (${UNIT_NAME[g.unit]})`,
    confidence,
    reason: `${digits}자리 숫자 — 1970년부터 센 ${UNIT_NAME[g.unit]}로 보입니다`,
    rows: [...timeRows(g.ms, now), ...(g.unit === 's' ? [] : [{ label: '초로는', value: String(Math.floor(g.ms / 1000)) }])],
  };
}

function detectDate(s: string, now: number): Candidate | null {
  if (s.length > 40) return null;
  const d = parseDate(s);
  if (!d) return null;
  const notes: Note[] = [];
  if (d.assumedKst) notes.push({ text: d.dateOnly ? '시간대가 적혀 있지 않아 한국 시간 0시로 읽었습니다.' : '시간대가 적혀 있지 않아 한국 시간으로 읽었습니다.' });
  return {
    kind: 'date',
    title: '날짜 · 시각',
    confidence: 0.9,
    reason: '날짜 · 시각을 적은 글 — 유닉스 시간으로 바꿨습니다',
    rows: [{ label: '유닉스 시간 (초)', value: String(Math.floor(d.ms / 1000)) }, { label: '유닉스 시간 (밀리초)', value: String(d.ms) }, ...timeRows(d.ms, now)],
    notes,
  };
}

function detectHtml(s: string): Candidate | null {
  ENTITY_RE.lastIndex = 0;
  if (!ENTITY_RE.test(s)) return null;
  const r = htmlDecode(s);
  if (!r.count) return null;
  return { kind: 'html', title: 'HTML 엔티티', confidence: 0.85, reason: `&…; 꼴 엔티티 ${n(r.count)}개를 글자로 바꿨습니다`, ...asText(r.text) };
}

function detectEscape(s: string): Candidate | null {
  if (!s.includes('\\')) return null;
  // \x41\x42 만 이어진 것은 16진수 쪽에서 바이트로 읽는다
  if (/^(?:\\x[0-9a-f]{2}\s*)+$/i.test(s)) return null;
  if (/^"(?:[^"\\\n]|\\.)*"$/.test(s)) {
    try {
      const text = JSON.parse(s) as string;
      const unicode = /\\u/.test(s);
      return { kind: 'escape', title: 'JSON 문자열', confidence: unicode ? 0.92 : 0.7, reason: '따옴표로 싸인 JSON 문자열 — \\ 이스케이프를 풀었습니다', ...asText(text) };
    } catch {}
  }
  const r = unescapeJs(s);
  if (!r.count || r.text === s) return null;
  return {
    kind: 'escape',
    title: '유니코드 이스케이프',
    confidence: r.unicode ? 0.9 : 0.4,
    reason: r.unicode ? `\\u · \\x 꼴 이스케이프 ${n(r.count)}개를 글자로 바꿨습니다` : `\\n · \\t 같은 이스케이프 ${n(r.count)}개를 풀었습니다 (윈도 경로라면 무시하세요)`,
    ...asText(r.text),
  };
}

function detectMime(s: string): Candidate | null {
  MIME_WORD_RE.lastIndex = 0;
  if (!MIME_WORD_RE.test(s)) return null;
  const r = mimeWordDecode(s);
  if (!r) return null;
  return { kind: 'mime', title: '메일 머리글 (MIME)', confidence: 0.97, reason: `=?글자집합?B/Q?…?= 꼴 — 메일 제목 · 이름에 쓰는 인코딩입니다 (${r.charsets.join(', ')})`, ...asText(r.text) };
}

function detectQp(s: string): Candidate | null {
  const hits = s.match(/=[0-9A-F]{2}/g);
  const soft = /=\r?\n/.test(s);
  if (!hits || (hits.length < 2 && !soft) || /=\?[A-Za-z0-9_-]+\?[BbQq]\?/.test(s)) return null;
  const bytes = qpBytes(s);
  if (!bytes) return null;
  let text = utf8Decode(bytes);
  let charset = 'UTF-8';
  if (text == null) {
    text = decodeAs(bytes, 'euc-kr');
    charset = 'EUC-KR';
  }
  // 그냥 a=41 같은 글과 헷갈리지 않게, 풀어서 한글 따위가 나와야 한다
  if (text == null || !isReadable(text) || (!soft && !/[^\x00-\x7f]/.test(text))) return null;
  return { kind: 'qp', title: 'Quoted-Printable', confidence: 0.8, reason: `=XX 꼴 ${n(hits.length)}곳 — 메일 본문에 쓰는 quoted-printable 입니다 (${charset})`, ...asText(text) };
}

function detectPunycode(s: string): Candidate | null {
  if (s.length > 300) return null;
  if (/^[a-z0-9.-]+$/i.test(s) && /(?:^|\.)xn--/i.test(s)) {
    const uni = toUnicode(s);
    if (!uni) return null;
    return { kind: 'punycode', title: 'Punycode 도메인', confidence: 0.95, reason: 'xn-- 로 시작하는 토막 — 한글 도메인을 영문으로 적은 Punycode 입니다', text: uni, again: false };
  }
  // 거꾸로: 한글 도메인
  if (/[^\x00-\x7f]/.test(s) && /^[^\s/?#@:]+(?:\.[^\s/?#@:]+)*\.(?:[a-z]{2,}|한국)$/i.test(s)) {
    const ascii = toAscii(s);
    if (!ascii) return null;
    return { kind: 'punycode', title: '한글 도메인', confidence: 0.6, reason: '한글이 든 도메인 — 실제로는 Punycode 로 바뀌어 오갑니다', text: ascii, again: false };
  }
  return null;
}

function detectMojibake(s: string): Candidate | null {
  if (s.length > 1_000_000) return null;
  const fixed = fixMojibake(s);
  if (fixed == null) return null;
  return { kind: 'mojibake', title: '깨진 글 되살리기', confidence: 0.8, reason: 'UTF-8 로 적은 글을 Latin-1 로 잘못 읽어 깨진 것으로 보입니다 — 되돌렸습니다', ...asText(fixed) };
}

function detectJson(s: string): Candidate | null {
  const pretty = prettyJson(s);
  if (pretty == null) return null;
  return { kind: 'json', title: 'JSON', confidence: 0.5, reason: 'JSON 입니다 — 보기 좋게 줄을 나눴습니다 (표 · 트리로 보려면 데이터 뷰어)', text: pretty, json: true, again: false };
}

/** 이보다 낮은 읽기는 버린다 */
export const MIN_CONFIDENCE = 0.2;

/**
 * 글이 무엇인지 알아본다. 확실한 것부터. 아무것도 아니면 빈 배열.
 * 어떤 글이 들어와도 던지지 않는다.
 */
export function detect(input: string, now = Date.now()): Candidate[] {
  const s = input.trim();
  if (!s) return [];
  const detectors: ((s: string, now: number) => Candidate | null)[] = [
    detectJwt,
    detectUrl,
    detectDataUri,
    detectMime,
    detectUuid,
    detectUlid,
    detectObjectId,
    detectUnix,
    detectDate,
    detectHash,
    detectHex,
    detectBase64,
    detectPercent,
    detectHtml,
    detectEscape,
    detectQp,
    detectPunycode,
    detectMojibake,
    detectJson,
  ];
  const out: Candidate[] = [];
  for (const fn of detectors) {
    try {
      const c = fn(s, now);
      if (c && c.confidence >= MIN_CONFIDENCE) {
        if (c.notes && !c.notes.length) delete c.notes;
        out.push(c);
      }
    } catch {
      // 한 가지 읽기가 실패해도 나머지는 보여 준다
    }
  }
  // 주소 안의 퍼센트 인코딩은 주소 카드가 이미 풀어 보였다
  const filtered = out.some((c) => c.kind === 'url' || c.kind === 'datauri') ? out.filter((c) => c.kind !== 'percent') : out;
  return filtered.map((c, i) => ({ c, i })).sort((a, b) => b.c.confidence - a.c.confidence || a.i - b.i).map((x) => x.c);
}

/** 확실한 정도를 말로 */
export function confidenceLabel(c: number): string {
  return c >= 0.9 ? '거의 확실' : c >= 0.6 ? '그럴듯함' : '혹시';
}
