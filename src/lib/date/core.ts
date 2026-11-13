// 날짜는 1970-01-01 부터 센 날 수(정수)로 다룬다. 시간대와 서머타임에 흔들리지 않는다.

export type Day = number;

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function toDay(y: number, m: number, d: number): Day {
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function fromDay(day: Day): Ymd {
  const t = new Date(day * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 0 = 일요일 */
export function weekday(day: Day): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function monthLength(y: number, m: number): number {
  return toDay(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - toDay(y, m, 1);
}

/** 있는 날짜인지 확인하고 날 수로 (2월 30일은 null) */
export function validDay(y: number, m: number, d: number): Day | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > monthLength(y, m)) return null;
  return toDay(y, m, d);
}

/** 내 컴퓨터 시계의 오늘 */
export function today(now = new Date()): Day {
  return toDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const p2 = (n: number) => String(n).padStart(2, '0');

export function iso(day: Day): string {
  const { y, m, d } = fromDay(day);
  return `${y}-${p2(m)}-${p2(d)}`;
}

/**
 * 손으로 적은 날짜를 읽는다: 2026-11-13 · 2026.11.13 · 2026/11/13 · 20261113 · 2026년 11월 13일.
 * 해를 빼면(11/13 · 11월 13일) baseYear 의 날짜로 본다.
 */
export function parseDate(text: string, baseYear = fromDay(today()).y): Day | null {
  const s = text.trim().replace(/\([일월화수목금토]\)$/, '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s) ?? /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?\.?$/.exec(s);
  if (m) return validDay(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/.exec(s);
  if (m) return validDay(baseYear, +m[1], +m[2]);
  return null;
}

/** 2026년 11월 13일 (금) */
export function fmt(day: Day): string {
  const { y, m, d } = fromDay(day);
  return `${y}년 ${m}월 ${d}일 (${WEEKDAYS[weekday(day)]})`;
}

/** 11월 13일 (금) */
export function fmtShort(day: Day): string {
  const { m, d } = fromDay(day);
  return `${m}월 ${d}일 (${WEEKDAYS[weekday(day)]})`;
}

/** 달을 더한다. 없는 날이면 그 달 말일로 (1월 31일 + 1개월 → 2월 28일) */
export function addMonths(day: Day, n: number): { day: Day; clamped: boolean } {
  const { y, m, d } = fromDay(day);
  const idx = y * 12 + (m - 1) + n;
  const ty = Math.floor(idx / 12);
  const tm = (idx % 12) + 1;
  const len = monthLength(ty, tm);
  return { day: toDay(ty, tm, Math.min(d, len)), clamped: d > len };
}

/** a 에서 b 까지를 년 · 개월 · 일로 (a ≤ b) */
export function diffYmd(a: Day, b: Day): { years: number; months: number; days: number } {
  const A = fromDay(a);
  const B = fromDay(b);
  let months = (B.y - A.y) * 12 + (B.m - A.m);
  if (addMonths(a, months).day > b) months--;
  return { years: Math.floor(months / 12), months: months % 12, days: b - addMonths(a, months).day };
}

/** 그 해의 몇 번째 날 */
export function dayOfYear(day: Day): number {
  return day - toDay(fromDay(day).y, 1, 1) + 1;
}

/** ISO 8601 주 번호 (월요일 시작, 첫 목요일이 든 주가 1주) */
export function isoWeek(day: Day): { year: number; week: number } {
  const thursday = day - ((weekday(day) + 6) % 7) + 3;
  const year = fromDay(thursday).y;
  return { year, week: Math.floor((thursday - toDay(year, 1, 1)) / 7) + 1 };
}
