// 퇴직금 (근로자퇴직급여 보장법 제8조)과 퇴직소득세 (소득세법 제48조 · 제55조).
import { basicTax } from './core';
import { RATES } from './rates';

const DAY = 86_400_000;
const floorTo = (v: number, unit: number) => Math.floor(v / unit + 1e-9) * unit;

/** 'YYYY-MM-DD' → UTC 자정. 잘못된 날짜는 null */
export function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 ? d : null;
}
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

/** 몇 달 앞뒤 같은 날 (그달에 그날이 없으면 그달 마지막 날) */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

/** 퇴직소득세의 근속연수: 입사일부터 퇴직일까지, 1년 미만 끝수는 1년으로 */
export function serviceYears(start: Date, end: Date): number {
  if (end <= start) return 0;
  let y = end.getUTCFullYear() - start.getUTCFullYear();
  if (addMonths(start, y * 12) > end) y--;
  return addMonths(start, y * 12) < end ? y + 1 : y;
}

/** [상한, 아래 구간까지 더한 값, 비율] 표에서 공제액 */
function tier(table: [number, number, number][], x: number): number {
  let lo = 0;
  for (const [hi, base, rate] of table) {
    if (x <= hi) return base + (x - lo) * rate;
    lo = hi;
  }
  return 0;
}

export interface RetirementTax {
  years: number;
  serviceDeduction: number;
  /** 환산급여: (퇴직금 − 근속연수공제) × 12 ÷ 근속연수 */
  converted: number;
  convertedDeduction: number;
  /** 과세표준 */
  base: number;
  /** 환산산출세액 (과세표준에 기본세율) */
  convertedTax: number;
  incomeTax: number;
  localTax: number;
  total: number;
}

export function retirementTax(pay: number, years: number): RetirementTax {
  const y = Math.max(1, Math.floor(years));
  const serviceDeduction = tier(RATES.retirement.service, y);
  const converted = Math.floor((Math.max(0, pay - serviceDeduction) * 12) / y);
  const convertedDeduction = Math.min(converted, Math.floor(tier(RATES.retirement.converted, converted)));
  const base = converted - convertedDeduction;
  const convertedTax = Math.floor(basicTax(base));
  const incomeTax = floorTo((convertedTax * y) / 12, 10);
  const localTax = floorTo(incomeTax * RATES.localTax, 10);
  return { years: y, serviceDeduction, converted, convertedDeduction, base, convertedTax, incomeTax, localTax, total: incomeTax + localTax };
}

export interface SeveranceInput {
  /** 입사일 */
  start: string;
  /** 마지막으로 일한 날 (퇴직일은 그다음 날) */
  last: string;
  /** 퇴직 전 3개월 동안 받은 월 임금 (세전, 기본급 + 고정 수당) */
  monthly: number;
  /** 퇴직 전 1년 동안 받은 상여금 */
  bonus: number;
  /** 퇴직 전 1년 동안 받은 연차수당 */
  leave: number;
}

export interface Severance {
  /** 재직일수 (입사일 ~ 마지막 근무일) */
  days: number;
  /** 1년 이상 일했는가 */
  eligible: boolean;
  /** 퇴직일 */
  end: Date;
  /** 평균임금을 셈하는 3개월 [시작, 퇴직일) 과 그 일수 */
  periodFrom: Date;
  periodDays: number;
  /** 3개월 임금 총액 (월 임금 × 3 + 상여 · 연차수당의 3/12) */
  wages: number;
  /** 1일 평균임금 */
  daily: number;
  pay: number;
  tax: RetirementTax;
  net: number;
}

export function severance(i: SeveranceInput): Severance | null {
  const start = parseDate(i.start);
  const last = parseDate(i.last);
  if (!start || !last || last < start) return null;
  const end = new Date(last.getTime() + DAY);
  const days = daysBetween(start, end);
  let periodFrom = addMonths(end, -3);
  if (periodFrom < start) periodFrom = start;
  const periodDays = daysBetween(periodFrom, end);
  const monthly = Math.max(0, i.monthly || 0);
  const wages = monthly * 3 + (Math.max(0, i.bonus || 0) * 3) / 12 + (Math.max(0, i.leave || 0) * 3) / 12;
  const daily = periodDays ? wages / periodDays : 0;
  const eligible = days >= 365;
  const pay = eligible ? Math.floor((daily * 30 * days) / 365) : 0;
  const tax = retirementTax(pay, serviceYears(start, end));
  return { days, eligible, end, periodFrom, periodDays, wages, daily, pay, tax, net: pay - tax.total };
}
