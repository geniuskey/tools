// 시급으로 받는 사람: 주휴수당 · 연장 · 야간 가산을 넣은 주급 · 월급.
import { RATES } from './rates';

/** 한 해 평균 한 달은 365 ÷ 7 ÷ 12 ≈ 4.345주 */
export const WEEKS_PER_MONTH = 365 / 7 / 12;

export interface HourlyInput {
  wage: number;
  /** 하루 일하는 시간 (쉬는 시간 빼고) */
  hoursPerDay: number;
  daysPerWeek: number;
  /** 한 주 야간(밤 10시 ~ 아침 6시) 시간 */
  nightPerWeek: number;
  /** 상시 5명 이상 사업장: 연장 · 야간에 50% 더 */
  five: boolean;
}

export interface Hourly {
  weekHours: number;
  /** 소정근로시간 (하루 8 · 한 주 40 까지) */
  regularHours: number;
  overtimeHours: number;
  nightHours: number;
  /** 주휴수당을 받는가 (한 주 소정근로 15시간 이상) */
  holidayOk: boolean;
  holidayHours: number;
  base: number;
  overtime: number;
  night: number;
  holiday: number;
  weekly: number;
  monthly: number;
  /** 월 소정근로 + 주휴 시간 (연장 · 야간은 따로) */
  monthHours: number;
  /** 주휴를 넣은 실제 시급 */
  effective: number;
  underMin: boolean;
}

export function hourly(i: HourlyInput): Hourly {
  const wage = Math.max(0, i.wage || 0);
  const hpd = Math.min(24, Math.max(0, i.hoursPerDay || 0));
  const days = Math.min(7, Math.max(0, Math.floor(i.daysPerWeek || 0)));
  const weekHours = hpd * days;
  const regularHours = Math.min(Math.min(hpd, 8) * days, 40);
  const overtimeHours = weekHours - regularHours;
  const nightHours = Math.min(weekHours, Math.max(0, i.nightPerWeek || 0));
  const holidayOk = regularHours >= 15;
  const holidayHours = holidayOk ? (regularHours / 40) * 8 : 0;
  const base = weekHours * wage;
  const overtime = i.five ? overtimeHours * wage * 0.5 : 0;
  const night = i.five ? nightHours * wage * 0.5 : 0;
  const holiday = holidayHours * wage;
  const weekly = base + overtime + night + holiday;
  // 월급은 고용노동부 방식대로 (소정근로 + 주휴) × 4.345주를 시간으로 반올림 (주 40시간이면 209시간)
  const monthHours = Math.round((regularHours + holidayHours) * WEEKS_PER_MONTH);
  const extra = (overtimeHours * wage + overtime + night) * WEEKS_PER_MONTH;
  return {
    weekHours,
    regularHours,
    overtimeHours,
    nightHours,
    holidayOk,
    holidayHours,
    base: Math.floor(base),
    overtime: Math.floor(overtime),
    night: Math.floor(night),
    holiday: Math.floor(holiday),
    weekly: Math.floor(weekly),
    monthly: Math.floor(monthHours * wage + extra),
    monthHours,
    effective: weekHours ? weekly / weekHours : 0,
    underMin: wage > 0 && wage < RATES.minWage.hourly,
  };
}
