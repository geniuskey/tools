// 근무일 계산: 주말 · 공휴일 · 회사가 정한 쉬는 날을 빼고 센다.
import { WEEKDAYS, fmtShort, fromDay, iso, toDay, validDay, weekday, type Day } from './core';
import { holidayMap, holidaysOf, type Holiday } from './holidays';

export interface CustomOff {
  /** null 이면 해마다 */
  year: number | null;
  month: number;
  date: number;
  name: string;
}

export interface Rules {
  sat: boolean;
  sun: boolean;
  holidays: boolean;
  /** 5월 1일 노동절 */
  labor: boolean;
  custom: CustomOff[];
}

export const defaultRules: Rules = { sat: true, sun: true, holidays: true, labor: true, custom: [] };

/**
 * 회사가 따로 쉬는 날. 한 줄에 하나: "2026-12-31 종무식", "12/24 창립기념일" (해를 빼면 해마다).
 * 읽지 못한 줄은 bad 로 돌려준다.
 */
export function parseCustom(text: string): { list: CustomOff[]; bad: string[] } {
  const list: CustomOff[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:(\d{4})\s*[-./년]\s*)?(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?[\s,:]*(.*)$/.exec(line);
    // 해가 없으면 윤년(2024)으로 있는 날짜인지만 본다
    if (!m || validDay(m[1] ? +m[1] : 2024, +m[2], +m[3]) == null) {
      bad.push(line);
      continue;
    }
    list.push({ year: m[1] ? +m[1] : null, month: +m[2], date: +m[3], name: m[4].trim() || '쉬는 날' });
  }
  return { list, bad };
}

export interface Off {
  /** 왜 쉬는지 (공휴일 이름 · 회사 쉬는 날 이름 · 토요일 · 일요일) */
  name: string;
  kind: 'weekend' | 'holiday' | 'custom';
}

/** 쉬는 날이면 이유를, 일하는 날이면 null */
export function offOf(day: Day, rules: Rules): Off | null {
  const { y, m, d } = fromDay(day);
  if (rules.holidays) {
    const h = holidayMap(y, rules.labor).get(day);
    if (h) return { name: h.name, kind: 'holiday' };
  } else if (rules.labor && m === 5 && d === 1) {
    return { name: y >= 2026 ? '노동절' : '근로자의 날', kind: 'holiday' };
  }
  const c = rules.custom.find((x) => x.month === m && x.date === d && (x.year == null || x.year === y));
  if (c) return { name: c.name, kind: 'custom' };
  const wd = weekday(day);
  if ((wd === 6 && rules.sat) || (wd === 0 && rules.sun)) return { name: `${WEEKDAYS[wd]}요일`, kind: 'weekend' };
  return null;
}

export interface Named {
  day: Day;
  name: string;
}

export interface Between {
  /** b 가 a 보다 앞이면 −1 */
  sign: 1 | -1;
  days: number;
  work: number;
  weekend: number;
  /** 평일에 걸려서 근무일을 줄인 쉬는 날 */
  holidays: Named[];
}

/**
 * 두 날짜 사이. 첫날은 세지 않는다 (오늘 → 내일 = 1일). includeStart 면 첫날도 센다 (기간 · 행사 일수).
 */
export function between(a: Day, b: Day, rules: Rules, includeStart = false): Between {
  const sign = b < a ? -1 : 1;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: Between = { sign, days: hi - lo + (includeStart ? 1 : 0), work: 0, weekend: 0, holidays: [] };
  for (let d = includeStart ? lo : lo + 1; d <= hi; d++) {
    const off = offOf(d, rules);
    if (!off) out.work++;
    else if (off.kind === 'weekend') out.weekend++;
    else if (weekday(d) % 6 === 0 && ((weekday(d) === 6 && rules.sat) || (weekday(d) === 0 && rules.sun))) out.weekend++;
    else out.holidays.push({ day: d, name: off.name });
  }
  return out;
}

export interface Moved {
  day: Day;
  /** 건너뛴 쉬는 날 */
  skipped: (Named & { kind: Off['kind'] })[];
}

/** 근무일로 n 일 뒤 (음수면 앞). 기준일은 세지 않는다 */
export function addWorkdays(a: Day, n: number, rules: Rules): Moved {
  const step = n < 0 ? -1 : 1;
  const skipped: Moved['skipped'] = [];
  let left = Math.abs(Math.trunc(n));
  let day = a;
  // 쉬는 날만 이어지는 규칙에서도 끝나게 한다
  for (let guard = 0; left > 0 && guard < 200_000; guard++) {
    day += step;
    const off = offOf(day, rules);
    if (off) skipped.push({ day, name: off.name, kind: off.kind });
    else left--;
  }
  return { day, skipped };
}

/** day 가 쉬는 날이면 그 뒤(step = 1) 또는 앞(−1)의 첫 근무일 */
export function nearestWorkday(day: Day, rules: Rules, step: 1 | -1 = 1): Day {
  let d = day;
  for (let guard = 0; offOf(d, rules) && guard < 400; guard++) d += step;
  return d;
}

// ── 한 해 ────────────────────────────────────────────────────────────────

export interface Run {
  from: Day;
  to: Day;
  days: number;
  /** 이 연휴를 만든 공휴일 이름 */
  names: string[];
}

export interface Bridge extends Run {
  /** 연차를 낼 날 */
  leave: Day[];
}

export interface YearSummary {
  holidays: Holiday[];
  /** 달마다 근무일 수 (1월부터) */
  monthWork: number[];
  work: number;
  /** 평일에 걸린 공휴일 수 */
  weekdayHolidays: number;
  /** 사흘 넘게 이어서 쉬는 날 */
  runs: Run[];
  /** 연차 하루 이틀로 이을 수 있는 곳 */
  bridges: Bridge[];
}

export function yearSummary(y: number, rules: Rules): YearSummary {
  const start = toDay(y, 1, 1);
  const end = toDay(y, 12, 31);
  const monthWork = Array<number>(12).fill(0);
  let weekdayHolidays = 0;
  for (let d = start; d <= end; d++) {
    const off = offOf(d, rules);
    if (!off) monthWork[fromDay(d).m - 1]++;
    else if (off.kind !== 'weekend' && weekday(d) !== 0 && weekday(d) !== 6) weekdayHolidays++;
  }

  // 해가 바뀌는 곳의 연휴도 보이게 앞뒤로 넉넉히 훑는다
  const lo = start - 14;
  const hi = end + 14;
  const blocks: { from: Day; to: Day; names: string[] }[] = [];
  for (let d = lo; d <= hi; d++) {
    const off = offOf(d, rules);
    if (!off) continue;
    const last = blocks[blocks.length - 1];
    const block = last && last.to === d - 1 ? last : (blocks.push({ from: d, to: d, names: [] }), blocks[blocks.length - 1]);
    block.to = d;
    if (off.kind !== 'weekend') for (const n of off.name.split(' · ').map((x) => x.replace(/ 연휴$/, ''))) if (!block.names.includes(n)) block.names.push(n);
  }
  const inYear = (b: { from: Day; to: Day }) => b.to >= start && b.from <= end;
  const runs = blocks.filter((b) => inYear(b) && b.to - b.from >= 2).map((b) => ({ ...b, days: b.to - b.from + 1 }));
  const bridges: Bridge[] = [];
  for (let i = 0; i + 1 < blocks.length; i++) {
    const a = blocks[i];
    const b = blocks[i + 1];
    const gap = b.from - a.to - 1;
    if (gap < 1 || gap > 2 || !inYear({ from: a.to + 1, to: b.from - 1 })) continue;
    const leave = Array.from({ length: gap }, (_, k) => a.to + 1 + k);
    bridges.push({ from: a.from, to: b.to, days: b.to - a.from + 1, names: [...new Set([...a.names, ...b.names])], leave });
  }
  return { holidays: holidaysOf(y, rules.labor), monthWork, work: monthWork.reduce((s, n) => s + n, 0), weekdayHolidays, runs, bridges };
}

/** 사람이 읽는 기간: "2월 14일 (토) ~ 18일 (수)" */
export function fmtRange(from: Day, to: Day): string {
  const a = fromDay(from);
  const b = fromDay(to);
  if (a.y === b.y && a.m === b.m) return `${fmtShort(from)} ~ ${b.d}일 (${WEEKDAYS[weekday(to)]})`;
  return `${fmtShort(from)} ~ ${fmtShort(to)}`;
}

// ── 달력 파일 ────────────────────────────────────────────────────────────

/** 공휴일을 달력 앱에 넣을 수 있는 iCalendar 파일로 */
export function holidaysIcs(list: Named[], stamp = new Date()): string {
  const compact = (d: Day) => iso(d).replace(/-/g, '');
  const now = stamp.toISOString().replace(/[-:]|\.\d+/g, '');
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tools.euiyun.com//date//KO', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:대한민국 공휴일'];
  for (const h of list) {
    lines.push('BEGIN:VEVENT', `UID:${compact(h.day)}-holiday@tools.euiyun.com`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${compact(h.day)}`, `DTEND;VALUE=DATE:${compact(h.day + 1)}`, `SUMMARY:${esc(h.name)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
