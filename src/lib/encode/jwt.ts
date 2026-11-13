// JWT: 세 토막을 읽고, 등록된 클레임을 우리말로 풀고, HMAC 서명을 확인한다.

import { base64Decode, base64Encode, utf8Decode, utf8Encode } from './codec';
import { hmac, type ShaAlg } from './hash';
import { kst, relative } from './time';

export interface Jwt {
  header: Record<string, unknown>;
  payload: unknown;
  headerJson: string;
  /** 내용이 JSON 이 아니면 풀어낸 글 그대로 */
  payloadJson: string;
  alg: string;
  signature: Uint8Array;
  /** 서명 대상: 머리 + 점 + 내용 (원래 글자 그대로) */
  signingInput: string;
}

const JWT_RE = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]*)$/;

/** JWT 가 아니면 null. "Bearer " 가 앞에 붙어 있어도 읽는다 */
export function parseJwt(input: string): Jwt | null {
  const m = JWT_RE.exec(input.trim().replace(/^(?:Authorization:\s*)?Bearer\s+/i, ''));
  if (!m) return null;
  const head = decodeJson(m[1]);
  if (!head || typeof head.value !== 'object' || head.value === null || Array.isArray(head.value)) return null;
  const header = head.value as Record<string, unknown>;
  if (typeof header.alg !== 'string') return null;
  const bodyBytes = base64Decode(m[2]);
  const signature = base64Decode(m[3]);
  if (!bodyBytes || !signature) return null;
  const bodyText = utf8Decode(bodyBytes);
  if (bodyText == null) return null;
  let payload: unknown = bodyText;
  let payloadJson = bodyText;
  try {
    payload = JSON.parse(bodyText);
    payloadJson = JSON.stringify(payload, null, 2);
  } catch {}
  return { header, payload, headerJson: JSON.stringify(header, null, 2), payloadJson, alg: header.alg, signature, signingInput: `${m[1]}.${m[2]}` };
}

function decodeJson(part: string): { value: unknown } | null {
  const bytes = base64Decode(part);
  const text = bytes && utf8Decode(bytes);
  if (text == null) return null;
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

export interface Claim {
  key: string;
  /** 우리말 이름 */
  name: string;
  value: string;
  /** 시각이면 "3시간 12분 뒤 만료" 같은 풀이 */
  note?: string;
  tone?: 'bad' | 'ok';
}

const CLAIM_NAMES: Record<string, string> = {
  iss: '발급한 곳',
  sub: '대상 (누구의 토큰인가)',
  aud: '받는 곳',
  exp: '만료',
  nbf: '이때부터 유효',
  iat: '발급',
  jti: '토큰 번호',
};

/** 등록된 클레임(iss · sub · aud · exp · nbf · iat · jti)만 골라 풀이한다 */
export function explainClaims(payload: unknown, now: number): Claim[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return [];
  const p = payload as Record<string, unknown>;
  const out: Claim[] = [];
  for (const key of ['exp', 'iat', 'nbf', 'iss', 'sub', 'aud', 'jti']) {
    if (!(key in p)) continue;
    const v = p[key];
    const name = CLAIM_NAMES[key];
    if (key === 'exp' || key === 'iat' || key === 'nbf') {
      if (typeof v !== 'number' || !isFinite(v)) {
        out.push({ key, name, value: JSON.stringify(v), note: '숫자(유닉스 초)가 아닙니다', tone: 'bad' });
        continue;
      }
      // 밀리초로 잘못 넣은 토큰도 있다
      const ms = v > 1e11 ? v : v * 1000;
      const rel = relative(ms, now);
      let note: string;
      let tone: Claim['tone'];
      if (key === 'exp') {
        const expired = ms <= now;
        note = expired ? `${rel.replace(/ 전$/, ' 전에')} 만료됨` : `${rel} 만료`;
        if (rel === '지금') note = '방금 만료됨';
        tone = expired ? 'bad' : 'ok';
      } else if (key === 'nbf') {
        note = ms > now ? `${rel}부터 쓸 수 있습니다 — 아직 유효하지 않습니다` : `${rel}부터 유효`;
        tone = ms > now ? 'bad' : undefined;
      } else note = ms > now + 60_000 ? `${rel} — 발급 시각이 앞날입니다` : `${rel} 발급`;
      if (v > 1e11) note += ' (밀리초로 적혀 있습니다 — 표준은 초)';
      out.push({ key, name, value: kst(ms), note, tone });
    } else out.push({ key, name, value: typeof v === 'string' ? v : JSON.stringify(v) });
  }
  return out;
}

const HS: Record<string, ShaAlg> = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };

/** 이 도구가 서명을 확인할 수 있는 알고리즘인가 (HS256 · HS384 · HS512) */
export function canVerify(alg: string): boolean {
  return alg in HS;
}

/** 알고리즘을 한 줄로 */
export function describeAlg(alg: string): string {
  if (/^none$/i.test(alg)) return '서명 없음';
  if (alg in HS) return `HMAC + ${HS[alg]} — 비밀 키 하나로 서명하고 확인합니다`;
  if (/^RS\d+$/.test(alg)) return `RSA + SHA-${alg.slice(2)} — 개인 키로 서명, 공개 키로 확인`;
  if (/^PS\d+$/.test(alg)) return `RSA-PSS + SHA-${alg.slice(2)} — 개인 키로 서명, 공개 키로 확인`;
  if (/^ES\d+$/.test(alg)) return `ECDSA + SHA-${alg.slice(2)} — 개인 키로 서명, 공개 키로 확인`;
  if (alg === 'EdDSA') return 'EdDSA (Ed25519) — 개인 키로 서명, 공개 키로 확인';
  return '알 수 없는 알고리즘';
}

/** HS256/384/512 서명이 맞는가. 다른 알고리즘이면 null */
export async function verifyHmac(jwt: Jwt, secret: Uint8Array): Promise<boolean | null> {
  const alg = HS[jwt.alg];
  if (!alg) return null;
  const mac = await hmac(alg, secret, utf8Encode(jwt.signingInput));
  if (mac.length !== jwt.signature.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac[i] ^ jwt.signature[i];
  return diff === 0;
}

/** 예시 · 시험에 쓸 HS256 토큰을 만든다 */
export async function signHs256(payload: unknown, secret: string, header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }): Promise<string> {
  const enc = (v: unknown) => base64Encode(utf8Encode(JSON.stringify(v)), { url: true });
  const input = `${enc(header)}.${enc(payload)}`;
  const mac = await hmac(HS[String(header.alg)] ?? 'SHA-256', utf8Encode(secret), utf8Encode(input));
  return `${input}.${base64Encode(mac, { url: true })}`;
}
