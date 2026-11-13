// 음력. 표를 싣지 않고 달과 해의 위치를 계산해서 만든다 (Meeus, Astronomical Algorithms).
// - 달의 첫날은 합삭(해와 달이 같은 방향)이 든 날, 한국 표준시(UTC+9) 기준
// - 동지가 든 달이 11월. 두 동지 사이에 달이 열세 번 들면 중기가 없는 첫 달이 윤달
import { fromDay, type Day } from './core';

const RAD = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * RAD);

/** 지구 자전이 느려진 만큼의 보정 (TT − UT, 초). Espenak · Meeus 의 근사식 */
export function deltaT(year: number): number {
  if (year < 1900) {
    const t = (year - 1860) / 100;
    return 7.62 + 57.37 * t - 2517.54 * t ** 2 + 16806.68 * t ** 3 - 44736.24 * t ** 4 + 53282.24 * t ** 5;
  }
  if (year < 1920) {
    const t = year - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (year < 1941) {
    const t = year - 1920;
    return 21.2 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3;
  }
  if (year < 1961) {
    const t = year - 1950;
    return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547;
  }
  if (year < 1986) {
    const t = year - 1975;
    return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718;
  }
  if (year < 2005) {
    const t = year - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (year < 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t ** 2;
  }
  return -20 + 32 * ((year - 1820) / 100) ** 2 - 0.5628 * (2150 - year);
}

// 합삭 시각의 주기항: [계수, E 의 차수, M, M', F, Ω]
const MOON_TERMS: [number, number, number, number, number, number][] = [
  [-0.4072, 0, 0, 1, 0, 0],
  [0.17241, 1, 1, 0, 0, 0],
  [0.01608, 0, 0, 2, 0, 0],
  [0.01039, 0, 0, 0, 2, 0],
  [0.00739, 1, -1, 1, 0, 0],
  [-0.00514, 1, 1, 1, 0, 0],
  [0.00208, 2, 2, 0, 0, 0],
  [-0.00111, 0, 0, 1, -2, 0],
  [-0.00057, 0, 0, 1, 2, 0],
  [0.00056, 1, 1, 2, 0, 0],
  [-0.00042, 0, 0, 3, 0, 0],
  [0.00042, 1, 1, 0, 2, 0],
  [0.00038, 1, 1, 0, -2, 0],
  [-0.00024, 1, -1, 2, 0, 0],
  [-0.00017, 0, 0, 0, 0, 1],
  [-0.00007, 0, 2, 1, 0, 0],
  [0.00004, 0, 0, 2, -2, 0],
  [0.00004, 0, 3, 0, 0, 0],
  [0.00003, 0, 1, 1, -2, 0],
  [0.00003, 0, 0, 2, 2, 0],
  [-0.00003, 0, 1, 1, 2, 0],
  [0.00003, 0, -1, 1, 2, 0],
  [-0.00002, 0, -1, 1, -2, 0],
  [-0.00002, 0, 1, 3, 0, 0],
  [0.00002, 0, 0, 4, 0, 0],
];
// 행성의 영향: [계수, 상수, k 의 계수]
const PLANET_TERMS: [number, number, number][] = [
  [0.000325, 299.77, 0.107408],
  [0.000165, 251.88, 0.016321],
  [0.000164, 251.83, 26.651886],
  [0.000126, 349.42, 36.412478],
  [0.00011, 84.66, 18.206239],
  [0.000062, 141.74, 53.303771],
  [0.00006, 207.14, 2.453732],
  [0.000056, 154.84, 7.30686],
  [0.000047, 34.52, 27.261239],
  [0.000042, 207.19, 0.121824],
  [0.00004, 291.34, 1.844379],
  [0.000037, 161.72, 24.198154],
  [0.000035, 239.56, 25.513099],
  [0.000023, 331.55, 3.592518],
];

const SYNODIC = 29.530588861;

/** k 번째 합삭의 시각 (역표시 율리우스일). k = 0 은 2000년 1월 6일 */
export function newMoonJde(k: number): number {
  const T = k / 1236.85;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T ** 2 - 0.00000011 * T ** 3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T ** 2 + 0.00001238 * T ** 3 - 0.000000058 * T ** 4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T ** 2 - 0.00000227 * T ** 3 + 0.000000011 * T ** 4;
  const Om = 124.7746 - 1.56375588 * k + 0.0020672 * T ** 2 + 0.00000215 * T ** 3;
  let jde = 2451550.09766 + SYNODIC * k + 0.00015437 * T ** 2 - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  for (const [c, e, m, mp, f, om] of MOON_TERMS) jde += c * E ** e * sin(m * M + mp * Mp + f * F + om * Om);
  for (let i = 0; i < PLANET_TERMS.length; i++) {
    const [c, a, b] = PLANET_TERMS[i];
    jde += c * sin(a + b * k - (i === 0 ? 0.009173 * T * T : 0));
  }
  return jde;
}

/** 해의 겉보기 황경 (도, 0~360). 오차 0.01° 안쪽 */
export function sunLongitude(jde: number): number {
  const T = (jde - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
  const lon = L0 + C - 0.00569 - 0.00478 * sin(125.04 - 1934.136 * T);
  return ((lon % 360) + 360) % 360;
}

/** 해의 황경이 target 이 되는 시각. guess 근처(±몇 달)에서 찾는다 */
function solveLongitude(target: number, guess: number): number {
  let jde = guess;
  for (let i = 0; i < 8; i++) {
    const diff = ((((target - sunLongitude(jde)) % 360) + 540) % 360) - 180;
    jde += (diff * 365.2422) / 360;
    if (Math.abs(diff) < 1e-7) break;
  }
  return jde;
}

/** 역표시 율리우스일 → 한국 날짜 */
function kstDay(jde: number): Day {
  const year = 2000 + (jde - 2451545) / 365.25;
  return Math.floor(jde - deltaT(year) / 86400 - 2440587.5 + 9 / 24);
}

const moonCache = new Map<number, Day>();
function newMoonDay(k: number): Day {
  let d = moonCache.get(k);
  if (d == null) moonCache.set(k, (d = kstDay(newMoonJde(k))));
  return d;
}
/** day 가 든 음력 달이 시작한 합삭의 번호 */
function moonOf(day: Day): number {
  let k = Math.round((day - 10962) / SYNODIC);
  while (newMoonDay(k) > day) k--;
  while (newMoonDay(k + 1) <= day) k++;
  return k;
}

export interface LunarMonth {
  year: number;
  month: number;
  leap: boolean;
  /** 초하루 */
  start: Day;
  /** 그믐 다음 날 (다음 달 초하루) */
  end: Day;
}

const spanCache = new Map<number, LunarMonth[]>();
/** (Y−1)년 동짓달부터 Y년 시월까지 */
function span(Y: number): LunarMonth[] {
  const hit = spanCache.get(Y);
  if (hit) return hit;
  // 동지(270°)부터 다음 동지까지 중기 13개
  const first = 2451545 + (Y - 1 - 2000) * 365.2422 + 355;
  const terms: Day[] = [];
  for (let i = 0; i <= 12; i++) terms.push(kstDay(solveLongitude((270 + 30 * i) % 360, first + i * 30.4368)));
  const from = moonOf(terms[0]);
  const to = moonOf(terms[12]);
  const count = to - from;
  const months: LunarMonth[] = [];
  let num = 11;
  let leapDone = count === 12;
  for (let i = 0; i < count; i++) {
    const start = newMoonDay(from + i);
    const end = newMoonDay(from + i + 1);
    let leap = false;
    if (i > 0) {
      if (!leapDone && !terms.some((t) => t >= start && t < end)) {
        leap = true;
        leapDone = true;
      } else {
        num = (num % 12) + 1;
      }
    }
    months.push({ year: num >= 11 ? Y - 1 : Y, month: num, leap, start, end });
  }
  spanCache.set(Y, months);
  return months;
}

/** 음력 Y년의 달 (정월부터 섣달까지, 윤달 포함 12~13개) */
export function lunarMonths(Y: number): LunarMonth[] {
  return [...span(Y), ...span(Y + 1)].filter((m) => m.year === Y);
}

/** 그 해의 윤달 (없으면 0) */
export function leapMonthOf(Y: number): number {
  return lunarMonths(Y).find((m) => m.leap)?.month ?? 0;
}

export interface LunarDate {
  year: number;
  month: number;
  day: number;
  leap: boolean;
  /** 그 달의 날 수 (29 또는 30) */
  length: number;
}

export function toLunar(day: Day): LunarDate {
  const y = fromDay(day).y;
  for (const Y of [y, y + 1, y - 1]) {
    const m = span(Y).find((x) => day >= x.start && day < x.end);
    if (m) return { year: m.year, month: m.month, day: day - m.start + 1, leap: m.leap, length: m.end - m.start };
  }
  throw new Error('음력으로 바꿀 수 없는 날짜');
}

/** 음력 → 양력. 없는 날(29일까지인 달의 30일, 없는 윤달)은 null */
export function fromLunar(year: number, month: number, day: number, leap = false): Day | null {
  const m = lunarMonths(year).find((x) => x.month === month && x.leap === leap);
  if (!m || day < 1 || day > m.end - m.start) return null;
  return m.start + day - 1;
}

const STEMS = '갑을병정무기경신임계';
const BRANCHES = '자축인묘진사오미신유술해';
const ANIMALS = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];

/** 음력 해의 간지와 띠 (2026 → 병오, 말) */
export function ganji(year: number): { name: string; animal: string } {
  const s = (((year - 4) % 10) + 10) % 10;
  const b = (((year - 4) % 12) + 12) % 12;
  return { name: STEMS[s] + BRANCHES[b], animal: ANIMALS[b] };
}
