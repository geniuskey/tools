// 날짜 계산기의 상태. 탭(계산 · 공휴일 · 시간대 · 음력)이 같이 쓰고, 통째로 저장한다.
import { fromDay, iso, parseDate, today, type Day } from './core';
import { parseCustom, type Rules } from './work';
import { isZone } from './zones';

export type Mode = 'calc' | 'year' | 'zones' | 'lunar';
export type Unit = 'work' | 'day' | 'week' | 'month' | 'year';
export type Target = 'from' | 'to' | 'base';

export interface Dday {
  name: string;
  date: string;
}

const MODES: Mode[] = ['calc', 'year', 'zones', 'lunar'];
const UNITS: Unit[] = ['work', 'day', 'week', 'month', 'year'];

class DateState {
  today = $state(today());
  mode = $state<Mode>('calc');
  toast = $state('');

  // 날짜는 input[type=date] 에 맞춰 YYYY-MM-DD 로 든다. 빈 값은 "오늘" — 내일 열면 내일이 된다
  from = $state('');
  to = $state('');
  includeStart = $state(false);
  base = $state('');
  amount = $state(10);
  unit = $state<Unit>('work');
  back = $state(false);
  target = $state<Target>('to');
  ddays = $state<Dday[]>([]);

  sat = $state(true);
  sun = $state(true);
  holidays = $state(true);
  labor = $state(true);
  customText = $state('');

  year = $state(fromDay(today()).y);

  zones = $state<string[]>(['Asia/Seoul', 'America/Los_Angeles', 'Europe/London']);
  workFrom = $state(9);
  workTo = $state(18);

  solar = $state('');
  lunarYear = $state(fromDay(today()).y);
  lunarMonth = $state(1);
  lunarDay = $state(1);
  lunarLeap = $state(false);

  custom = $derived(parseCustom(this.customText));
  rules = $derived<Rules>({ sat: this.sat, sun: this.sun, holidays: this.holidays, labor: this.labor, custom: this.custom.list });

  /** 빈 값(오늘)을 날 수로 */
  day(value: string): Day {
    return (value && parseDate(value)) || this.today;
  }
  /** 오늘을 고르면 빈 값으로 둔다 */
  keep(day: Day): string {
    return day === this.today ? '' : iso(day);
  }

  say(msg: string) {
    this.toast = msg;
    setTimeout(() => this.toast === msg && (this.toast = ''), 2200);
  }
  async copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.say(`${what} 복사했습니다`);
    } catch {
      this.say('복사하지 못했습니다');
    }
  }

  snapshot() {
    const { mode, from, to, includeStart, base, amount, unit, back, target, ddays, sat, sun, holidays, labor, customText, zones, workFrom, workTo, solar, lunarYear, lunarMonth, lunarDay, lunarLeap } = this;
    return { mode, from, to, includeStart, base, amount, unit, back, target, ddays: $state.snapshot(ddays), sat, sun, holidays, labor, customText, zones: $state.snapshot(zones), workFrom, workTo, solar, lunarYear, lunarMonth, lunarDay, lunarLeap };
  }

  restore(s: Record<string, any>) {
    const date = (v: unknown) => (typeof v === 'string' && parseDate(v) != null ? v : '');
    const int = (v: unknown, lo: number, hi: number, fallback: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : fallback);
    const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
    if (MODES.includes(s.mode)) this.mode = s.mode;
    this.from = date(s.from);
    this.to = date(s.to);
    this.base = date(s.base);
    this.solar = date(s.solar);
    this.includeStart = bool(s.includeStart, false);
    this.amount = int(s.amount, 0, 100_000, 10);
    if (UNITS.includes(s.unit)) this.unit = s.unit;
    this.back = bool(s.back, false);
    if (['from', 'to', 'base'].includes(s.target)) this.target = s.target;
    if (Array.isArray(s.ddays)) this.ddays = s.ddays.filter((d: any) => d && typeof d.name === 'string' && date(d.date)).slice(0, 100);
    this.sat = bool(s.sat, true);
    this.sun = bool(s.sun, true);
    this.holidays = bool(s.holidays, true);
    this.labor = bool(s.labor, true);
    if (typeof s.customText === 'string') this.customText = s.customText.slice(0, 5000);
    if (Array.isArray(s.zones)) {
      const zones = [...new Set(s.zones as unknown[])].filter((z): z is string => typeof z === 'string' && isZone(z)).slice(0, 8);
      if (zones.length) this.zones = zones;
    }
    this.workFrom = int(s.workFrom, 0, 23, 9);
    this.workTo = int(s.workTo, 1, 24, 18);
    if (this.workTo <= this.workFrom) [this.workFrom, this.workTo] = [9, 18];
    this.lunarYear = int(s.lunarYear, 1900, 2100, this.lunarYear);
    this.lunarMonth = int(s.lunarMonth, 1, 12, 1);
    this.lunarDay = int(s.lunarDay, 1, 30, 1);
    this.lunarLeap = bool(s.lunarLeap, false);
  }
}

export const st = new DateState();
