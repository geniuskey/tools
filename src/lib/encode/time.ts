// 시각: 유닉스 시간 단위 짐작, 한국 시간으로 적기, "3일 전" 같은 상대 표현.

const KST = 9 * 3600_000;
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** Date 가 다룰 수 있는 범위 안에서, 사람이 쓸 법한 때 (1970 ~ 2200년) */
const MAX_MS = 7_258_118_400_000;

const p2 = (n: number) => String(n).padStart(2, '0');

/** 2026-11-13 (금) 14:30:05 KST */
export function kst(ms: number): string {
  const d = new Date(ms + KST);
  if (isNaN(d.getTime())) return '—';
  const frac = ms % 1000 ? '.' + String(((ms % 1000) + 1000) % 1000).padStart(3, '0') : '';
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} (${DAYS[d.getUTCDay()]}) ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}${frac} KST`;
}

/** 2026-11-13T05:30:05Z (밀리초가 0 이면 뺀다) */
export function utcIso(ms: number): string {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  return d.toISOString().replace('.000Z', 'Z');
}

/** 길이를 우리말로: 45초 · 12분 · 3시간 12분 · 2일 · 3개월 · 1년 2개월 */
export function span(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  if (d < 2) return h % 24 ? `${d}일 ${h % 24}시간` : `${d}일`;
  if (d < 60) return `${d}일`;
  const months = Math.floor(d / 30.44);
  if (months < 12) return `${months}개월`;
  const years = Math.floor(d / 365.25);
  const rest = Math.floor((d - years * 365.25) / 30.44);
  return rest ? `${years}년 ${rest}개월` : `${years}년`;
}

/** "3일 전" · "3시간 12분 뒤" · "지금" */
export function relative(ms: number, now: number): string {
  const diff = ms - now;
  if (Math.abs(diff) < 1000) return '지금';
  return `${span(diff)} ${diff < 0 ? '전' : '뒤'}`;
}

export type UnixUnit = 's' | 'ms' | 'us' | 'ns';
export const UNIT_NAME: Record<UnixUnit, string> = { s: '초', ms: '밀리초', us: '마이크로초', ns: '나노초' };

export interface UnixGuess {
  unit: UnixUnit;
  ms: number;
  /** 자릿수가 딱 맞는가 (10 · 13 · 16 · 19자리) — 아니면 덜 확실하다 */
  exact: boolean;
}

/**
 * 숫자를 유닉스 시간으로 읽는다. 자릿수로 단위를 짐작한다: 10자리 초, 13자리 밀리초, 16자리 마이크로초, 19자리 나노초.
 * 0 으로 시작하거나(전화번호 · 일련번호) 너무 짧거나 1970~2200년을 벗어나면 null.
 */
export function guessUnix(input: string): UnixGuess | null {
  const m = /^(\d{9,19})(?:\.(\d{1,9}))?$/.exec(input.trim());
  if (!m || m[1][0] === '0') return null;
  const digits = m[1].length;
  const unit: UnixUnit = digits <= 11 ? 's' : digits <= 14 ? 'ms' : digits <= 17 ? 'us' : 'ns';
  // 소수점은 초에만 붙는다 (1700000000.123)
  if (m[2] && unit !== 's') return null;
  let ms: number;
  if (unit === 's') ms = Number(m[1]) * 1000 + (m[2] ? Math.round(Number('0.' + m[2]) * 1000) : 0);
  else if (unit === 'ms') ms = Number(m[1]);
  else ms = Number(BigInt(m[1]) / (unit === 'us' ? 1000n : 1_000_000n));
  if (ms > MAX_MS) return null;
  return { unit, ms, exact: digits === 10 || digits === 13 || digits === 16 || digits === 19 };
}

export interface ParsedDate {
  ms: number;
  /** 시간대가 적혀 있지 않아 한국 시간으로 읽었는가 */
  assumedKst: boolean;
  /** 날짜만 적혀 있었는가 */
  dateOnly: boolean;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
const RFC_RE = /^(?:[A-Z][a-z]{2}, )?\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}(?::\d{2})? (?:GMT|UTC|[+-]\d{4})$/;

/** ISO 8601 (2026-11-13T05:30:00Z · 2026-11-13 14:30) 와 메일 · HTTP 머리글의 날짜를 읽는다 */
export function parseDate(input: string): ParsedDate | null {
  const s = input.trim();
  const m = ISO_RE.exec(s);
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', sec = '0', frac = '', zone] = m;
    const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, frac ? Math.round(Number('0.' + frac) * 1000) : 0);
    // 2월 30일처럼 없는 날짜는 받지 않는다
    const check = new Date(utc);
    if (check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || +h > 23 || +mi > 59 || +sec > 60) return null;
    let offset = KST;
    if (zone) {
      if (/^z$/i.test(zone)) offset = 0;
      else {
        const z = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone)!;
        offset = (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +(z[3] ?? 0)) * 60_000;
      }
    }
    return { ms: utc - offset, assumedKst: !zone, dateOnly: m[4] === undefined };
  }
  if (RFC_RE.test(s)) {
    const ms = Date.parse(s);
    if (!isNaN(ms)) return { ms, assumedKst: false, dateOnly: false };
  }
  return null;
}
