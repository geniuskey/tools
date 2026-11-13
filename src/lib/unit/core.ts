// 바꾸기와 적기. 값은 분수(Rat)로 들고 다니다가 보여 줄 때만 자른다.
import { Dec, add, div, exact, isZero, mul, rat, sub, value, type Rat } from './rat';
import { unitOf, type UnitDef } from './units';

export interface Ctx {
  /** 인쇄 · 화면 px 의 해상도 */
  dpi: number;
  /** 온도 차이로 (0점을 무시) */
  delta: boolean;
}

export const defaultCtx: Ctx = { dpi: 96, delta: false };

const cache = new Map<string, Rat>();
function cached(s: string): Rat {
  let r = cache.get(s);
  if (!r) cache.set(s, (r = rat(s)));
  return r;
}

export function factor(u: UnitDef, ctx: Ctx): Rat {
  return u.dpi ? rat(1, ctx.dpi) : cached(u.f);
}

/** 이 단위로 v 만큼 → 기준 단위로. 거꾸로 가는 단위에 0 을 넣으면 null */
export function toBase(v: Rat, u: UnitDef, ctx: Ctx = defaultCtx): Rat | null {
  const f = factor(u, ctx);
  if (u.inv) return isZero(v) ? null : div(f, v);
  if (u.off && !ctx.delta) return mul(add(v, cached(u.off)), f);
  return mul(v, f);
}

/** 기준 단위 → 이 단위로 */
export function fromBase(b: Rat, u: UnitDef, ctx: Ctx = defaultCtx): Rat | null {
  const f = factor(u, ctx);
  if (u.inv) return isZero(b) ? null : div(f, b);
  if (u.off && !ctx.delta) return sub(div(b, f), cached(u.off));
  return div(b, f);
}

export function convert(v: Rat, from: string, to: string, ctx: Ctx = defaultCtx): Rat | null {
  const b = toBase(v, unitOf(from), ctx);
  return b && fromBase(b, unitOf(to), ctx);
}

/** 여러 조각("5 ft 11 in")을 더한 기준 값 */
export function baseOf(parts: { value: Rat; id: string }[], ctx: Ctx = defaultCtx): Rat | null {
  let sum: Rat | null = null;
  for (const p of parts) {
    const b = toBase(p.value, unitOf(p.id), ctx);
    if (!b) return null;
    sum = sum ? add(sum, b) : b;
  }
  return sum;
}

// ── 적기 ──

export interface Shown {
  /** 쉼표를 넣은 글 (화면) */
  text: string;
  /** 쉼표 없는 글 (복사 · 입력창) */
  plain: string;
  /** 자른 값인가 */
  approx: boolean;
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

export function group(plain: string): string {
  const [int, frac] = plain.split('.');
  const sign = int.startsWith('-') ? '-' : '';
  const digits = sign ? int.slice(1) : int;
  const g = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + g + (frac ? '.' + frac : '');
}

/**
 * 유효숫자 sig 개로 적는다. 정수 부분은 자르지 않는다 (1,234,567.8 → 1,234,568).
 * 아주 크거나 작으면 1.23 × 10⁻⁹ 꼴.
 */
export function show(r: Rat, sig = 6): Shown {
  const q = value(r);
  const isExact = exact(r);
  if (q.isZero()) return { text: '0', plain: '0', approx: !isExact };
  const ex = q.e;
  if (ex >= 15 || ex < -6) {
    const m = q.toSignificantDigits(sig);
    const [mant, pow] = m.toExponential().split('e');
    const p = String(Number(pow));
    return { text: `${mant} × 10${[...p].map((c) => SUP[c]).join('')}`, plain: `${mant}e${p}`, approx: !isExact || !m.eq(q) };
  }
  const dp = ex >= 0 ? Math.max(0, sig - ex - 1) : sig - ex - 1;
  const v = q.toDecimalPlaces(dp);
  let plain = v.toFixed();
  if (v.isZero()) plain = '0';
  return { text: group(plain), plain, approx: !isExact || !v.eq(q) };
}

/** 사람이 읽는 수: 화면 글자 */
export const fmt = (r: Rat, sig = 6) => show(r, sig).text;

/** 기간: "1일 2시간 3분 4.5초" */
export function duration(seconds: Rat): string {
  const s = value(seconds);
  if (s.isNeg()) return '-' + duration({ n: seconds.n.neg(), d: seconds.d });
  if (s.lt(1)) return `${show(seconds, 3).text}초`;
  const total = s.lt(600) ? s.toDecimalPlaces(1) : s.toDecimalPlaces(0);
  const days = total.div(86400).floor();
  let rest = total.sub(days.mul(86400));
  const h = rest.div(3600).floor();
  rest = rest.sub(h.mul(3600));
  const m = rest.div(60).floor();
  rest = rest.sub(m.mul(60));
  const out: string[] = [];
  if (!days.isZero()) out.push(`${group(days.toFixed())}일`);
  if (!h.isZero()) out.push(`${h.toFixed()}시간`);
  if (!m.isZero()) out.push(`${m.toFixed()}분`);
  if (!rest.isZero() && days.lt(1)) out.push(`${rest.toFixed()}초`);
  return out.join(' ') || '0초';
}

/** 피트 · 인치로: 1.8034 m → 5 ft 11 in */
export function feetInches(meters: Rat): string {
  const inches = value(meters).div('0.0254');
  let ft = inches.div(12).floor();
  let inch = inches.sub(ft.mul(12)).toDecimalPlaces(2);
  if (inch.gte(12)) {
    ft = ft.add(1);
    inch = new Dec(0);
  }
  return `${group(ft.toFixed())} ft ${inch.toFixed()} in`;
}

/** 받는 데 걸리는 시간 (초): 바이트 × 8 ÷ 비트/초 */
export function transferSeconds(bytes: Rat, bitsPerSecond: Rat): Rat | null {
  if (isZero(bitsPerSecond)) return null;
  return div(mul(bytes, rat(8)), bitsPerSecond);
}

const BIN = ['KB', 'MB', 'GB', 'TB', 'PB'];
/** Windows 탐색기처럼 1024 로 나누고 GB 라고 적은 값. 1 KiB 보다 작으면 null */
export function windowsSize(bytes: Rat): string | null {
  const q = value(bytes);
  if (q.lt(1024)) return null;
  let k = 0;
  while (k < BIN.length && q.gte(new Dec(1024).pow(k + 1))) k++;
  return `${show(div(bytes, rat(new Dec(1024).pow(k))), 3).text} ${BIN[k - 1]}`;
}

const SI = ['KB', 'MB', 'GB', 'TB', 'PB'];
/** 제조사 · macOS 처럼 1000 으로 나눈 값 */
export function siSize(bytes: Rat): string {
  const q = value(bytes);
  let k = 0;
  while (k < SI.length && q.gte(new Dec(1000).pow(k + 1))) k++;
  return k ? `${show(div(bytes, rat(new Dec(1000).pow(k))), 3).text} ${SI[k - 1]}` : `${show(bytes, 3).text} B`;
}

export { rat, value };
