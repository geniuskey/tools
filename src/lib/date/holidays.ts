// 우리나라 공휴일. 음력 명절은 lunar.ts 로 계산하고, 대체공휴일은 「관공서의 공휴일에 관한 규정」의 규칙을 따른다.
import { toDay, weekday, type Day } from './core';
import { fromLunar } from './lunar';

export type HolidayKind = 'holiday' | 'substitute' | 'temp' | 'labor';

export interface Holiday {
  day: Day;
  name: string;
  kind: HolidayKind;
}

/** 규칙으로는 알 수 없는 날: 선거일과 임시공휴일 */
const ONE_OFF: Record<string, string> = {
  '2002-06-13': '지방선거',
  '2002-07-01': '임시공휴일',
  '2002-12-19': '대통령 선거',
  '2004-04-15': '국회의원 선거',
  '2006-05-31': '지방선거',
  '2007-12-19': '대통령 선거',
  '2008-04-09': '국회의원 선거',
  '2010-06-02': '지방선거',
  '2012-04-11': '국회의원 선거',
  '2012-12-19': '대통령 선거',
  '2014-06-04': '지방선거',
  '2015-08-14': '임시공휴일',
  '2016-04-13': '국회의원 선거',
  '2016-05-06': '임시공휴일',
  '2017-05-09': '대통령 선거',
  '2017-10-02': '임시공휴일',
  '2018-06-13': '지방선거',
  '2020-04-15': '국회의원 선거',
  '2020-08-17': '임시공휴일',
  '2022-03-09': '대통령 선거',
  '2022-06-01': '지방선거',
  '2023-10-02': '임시공휴일',
  '2024-04-10': '국회의원 선거',
  '2024-10-01': '임시공휴일',
  '2025-01-27': '임시공휴일',
  '2025-06-03': '대통령 선거',
  '2026-06-03': '지방선거',
  '2028-04-12': '국회의원 선거',
};
/** 선거일 · 임시공휴일을 어느 해까지 알고 있는지 */
export const ONE_OFF_UNTIL = 2028;

/** 대체공휴일이 생기는 조건: 일요일과 겹칠 때만 / 토 · 일요일과 겹칠 때 */
type Sub = 'none' | 'sunday' | 'weekend';

interface Base {
  day: Day;
  name: string;
  /** 하나로 이어진 휴일 (설 · 추석 연휴) 은 같은 묶음 */
  group: string;
  sub: Sub;
}

function baseHolidays(y: number): Base[] {
  const out: Base[] = [];
  const add = (m: number, d: number, name: string, sub: Sub) => out.push({ day: toDay(y, m, d), name, group: name, sub });
  const since = (from: number, sub: Sub): Sub => (y >= from ? sub : 'none');

  add(1, 1, '신정', 'none');
  if (y <= 1998) add(1, 2, '신정 연휴', 'none');
  const seol = fromLunar(y, 1, 1);
  if (seol != null) for (const o of [-1, 0, 1]) out.push({ day: seol + o, name: o ? '설날 연휴' : '설날', group: '설날', sub: since(2014, 'sunday') });
  add(3, 1, '삼일절', since(2022, 'weekend'));
  if (y <= 2005) add(4, 5, '식목일', 'none');
  add(5, 5, '어린이날', since(2014, 'weekend'));
  const buddha = fromLunar(y, 4, 8);
  if (buddha != null) out.push({ day: buddha, name: '부처님오신날', group: '부처님오신날', sub: since(2023, 'weekend') });
  add(6, 6, '현충일', 'none');
  // 제헌절은 2008년에 공휴일에서 빠졌다가 2026년에 돌아왔다
  if (y <= 2007 || y >= 2026) add(7, 17, '제헌절', since(2026, 'weekend'));
  add(8, 15, '광복절', since(2021, 'weekend'));
  const chuseok = fromLunar(y, 8, 15);
  if (chuseok != null) for (const o of [-1, 0, 1]) out.push({ day: chuseok + o, name: o ? '추석 연휴' : '추석', group: '추석', sub: since(2014, 'sunday') });
  add(10, 3, '개천절', since(2021, 'weekend'));
  // 한글날은 1991년에 빠졌다가 2013년에 돌아왔다
  if (y <= 1990 || y >= 2013) add(10, 9, '한글날', since(2021, 'weekend'));
  add(12, 25, '성탄절', since(2023, 'weekend'));
  return out;
}

const cache = new Map<string, Holiday[]>();

/**
 * 그 해의 공휴일을 날짜순으로. 같은 날 둘이 겹치면 이름을 이어 붙인다.
 * labor: 5월 1일 노동절(2025년까지 근로자의 날)도 넣는다 — 법정 공휴일은 아니지만 회사는 쉰다.
 */
export function holidaysOf(y: number, labor = true): Holiday[] {
  const key = `${y}:${labor}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const base = baseHolidays(y);
  const byDay = new Map<Day, Holiday>();
  const put = (day: Day, name: string, kind: HolidayKind) => {
    const prev = byDay.get(day);
    if (prev) prev.name += ` · ${name}`;
    else byDay.set(day, { day, name, kind });
  };
  for (const b of base) put(b.day, b.name, 'holiday');
  for (const [iso, name] of Object.entries(ONE_OFF)) {
    if (!iso.startsWith(`${y}-`)) continue;
    put(toDay(y, +iso.slice(5, 7), +iso.slice(8, 10)), name, 'temp');
  }
  if (labor) put(toDay(y, 5, 1), y >= 2026 ? '노동절' : '근로자의 날', 'labor');

  // 대체공휴일: 겹친 날마다 하루씩, 그 휴일(연휴)이 끝난 뒤 첫 평일에
  const taken = new Set(byDay.keys());
  const days = [...new Set(base.filter((b) => b.sub !== 'none').map((b) => b.day))].sort((a, b) => a - b);
  for (const day of days) {
    const here = base.filter((b) => b.day === day);
    const eligible = here.filter((b) => b.sub !== 'none');
    const wd = weekday(day);
    const clash = here.length > 1 || eligible.some((b) => wd === 0 || (wd === 6 && b.sub === 'weekend'));
    if (!clash) continue;
    const owner = eligible[0];
    let d = Math.max(...base.filter((b) => b.group === owner.group).map((b) => b.day)) + 1;
    while (taken.has(d) || weekday(d) === 0 || weekday(d) === 6) d++;
    taken.add(d);
    byDay.set(d, { day: d, name: `대체공휴일 (${owner.group})`, kind: 'substitute' });
  }

  // 설 연휴는 앞뒤 해로 넘어갈 수 있다. 이 해에 속한 날만 남긴다
  const from = toDay(y, 1, 1);
  const to = toDay(y, 12, 31);
  const list = [...byDay.values()].filter((h) => h.day >= from && h.day <= to).sort((a, b) => a.day - b.day);
  cache.set(key, list);
  return list;
}

const mapCache = new Map<string, Map<Day, Holiday>>();
/** 날짜로 바로 찾는 표 */
export function holidayMap(y: number, labor = true): Map<Day, Holiday> {
  const key = `${y}:${labor}`;
  let m = mapCache.get(key);
  if (!m) mapCache.set(key, (m = new Map(holidaysOf(y, labor).map((h) => [h.day, h]))));
  return m;
}
