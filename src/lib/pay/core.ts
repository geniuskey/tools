// 월급에서 떼는 돈: 4대 보험(국민연금 · 건강 · 장기요양 · 고용)과 근로소득세(간이세액표) · 지방소득세.
import { RATES, type PensionPeriod } from './rates';

const T = RATES.table;
const floorTo = (v: number, unit: number) => Math.floor(v / unit + 1e-9) * unit;

// ── 간이세액표 ───────────────────────────────────────────────

/** 근로소득공제 (연 총급여) */
export function earnedDeduction(g: number): number {
  const d = g <= 5e6 ? g * 0.7 : g <= 15e6 ? 3.5e6 + (g - 5e6) * 0.4 : g <= 45e6 ? 7.5e6 + (g - 15e6) * 0.15 : g <= 1e8 ? 12e6 + (g - 45e6) * 0.05 : 14.75e6 + (g - 1e8) * 0.02;
  return Math.min(d, 2e7);
}

/** 간이세액표의 "특별소득공제 등" (공제대상가족 수에 따라) */
export function specialDeduction(g: number, family: number): number {
  const [base, r] = family === 1 ? [3.1e6, [0.04, 0.04, 0.015, 0.005]] : family === 2 ? [3.6e6, [0.04, 0.04, 0.02, 0.01]] : [5e6, [0.07, 0.07, 0.05, 0.03]];
  let s = g <= 3e7 ? base + g * r[0] : g <= 4.5e7 ? base + g * r[1] - (g - 3e7) * 0.05 : g <= 7e7 ? base + g * r[2] : g <= 1.2e8 ? base + g * r[3] : 0;
  if (family >= 3 && g > 4e7) s += (g - 4e7) * 0.04;
  return s;
}

export function basicTax(base: number): number {
  let tax = 0;
  let prev = 0;
  for (const [limit, rate] of T.brackets) {
    if (base > prev) tax += (Math.min(base, limit) - prev) * rate;
    prev = limit;
  }
  return tax;
}

function credit(tax: number, g: number): number {
  const c = tax <= 5e5 ? tax * 0.55 : 275_000 + (tax - 5e5) * 0.3;
  const [a, b, c3] = T.creditLimits;
  return Math.min(c, g <= 5.5e7 ? a : g <= 7e7 ? b : c3);
}

/** 표의 한 칸을 계산한다: 월급여 m(그 줄의 가운데 값), 공제대상가족 수 1~11 */
function cell(m: number, family: number): number {
  const g = m * 12;
  const pension = floorTo(floorTo(Math.min(m, T.pensionCap), 1000) * T.pensionRate, 10) * 12;
  const base = Math.max(0, g - earnedDeduction(g) - 1.5e6 * family - pension - specialDeduction(g, family));
  const tax = basicTax(base);
  const monthly = floorTo(Math.max(0, tax - credit(tax, g)) / 12, 10);
  return monthly < 1000 ? 0 : monthly;
}

/** 월급여가 속한 표의 줄 [이상, 미만]. 77만 원 미만은 null, 1,000만 원은 한 줄 */
export function tableRow(m: number): [number, number] | null {
  if (m < 770_000) return null;
  if (m >= 10_000_000) return [10_000_000, 10_000_000];
  const step = m < 1_500_000 ? 5_000 : m < 3_000_000 ? 10_000 : 20_000;
  const lo = Math.floor(m / step) * step;
  return [lo, lo + step];
}

/** 간이세액표의 값 (자녀 공제 전). 가족이 11명을 넘으면 표의 주석대로 늘려 뺀다 */
export function tableTax(m: number, family: number): number {
  const fam = Math.max(1, Math.floor(family));
  if (fam > 11) {
    const t11 = tableTax(m, 11);
    const t10 = tableTax(m, 10);
    return Math.max(0, t11 - (t10 - t11) * (fam - 11));
  }
  const row = tableRow(m);
  if (!row) return 0;
  if (m > 10_000_000) {
    const base = cell(10_000_000, fam);
    let band = T.above[0];
    for (const b of T.above) if (m > b[0]) band = b;
    return floorTo(base + band[1] + (m - band[0]) * band[2], 10);
  }
  const mid = row[0] === row[1] ? row[0] : (row[0] + row[1]) / 2;
  const v = cell(mid, fam);
  return v > 0 ? Math.max(0, v - (T.quirks[row[0]] ?? 0)) : 0;
}

/** 8세 이상 20세 이하 자녀 공제 */
export function childCredit(children: number): number {
  const n = Math.max(0, Math.floor(children));
  if (n === 0) return 0;
  if (n === 1) return T.children[0];
  return T.children[1] + T.children[2] * (n - 2);
}

/** 매달 떼는 근로소득세: (표 − 자녀 공제) × 원천징수 비율 */
export function incomeTax(m: number, family: number, children: number, ratio = 1): number {
  const v = Math.max(0, tableTax(m, family) - childCredit(children));
  return floorTo(v * ratio, 10);
}

// ── 4대 보험 ─────────────────────────────────────────────────

/** 이 달에 쓰는 국민연금 기준소득월액 하한 · 상한 */
export function pensionPeriod(month: string): PensionPeriod {
  const list = RATES.pension.periods;
  let p = list[0];
  for (const x of list) if (x.from <= month) p = x;
  return p;
}

export function pension(m: number, month: string): number {
  const p = pensionPeriod(month);
  const base = floorTo(Math.min(Math.max(m, p.min), p.max), 1000);
  return floorTo(base * RATES.pension.rate, 10);
}

export function health(m: number): number {
  const h = RATES.health;
  return Math.min(h.maxPremium, Math.max(h.minPremium, floorTo(m * h.rate, 10)));
}

/** 장기요양보험료: 건강보험료 × (장기요양 요율 / 건강보험 요율) */
export function care(healthPremium: number): number {
  return floorTo((healthPremium * RATES.health.care) / RATES.health.total, 10);
}

export function employment(m: number): number {
  return floorTo(m * RATES.employment, 10);
}

// ── 한 달 실수령액 ───────────────────────────────────────────

export interface Input {
  /** 연봉 (원) */
  annual: number;
  /** 퇴직금이 연봉에 들어 있으면 13으로 나눈다 */
  severanceIncluded: boolean;
  /** 비과세 (월, 원): 식대 · 보육수당 … */
  nonTax: number;
  /** 공제대상가족 수 (본인 포함) */
  family: number;
  /** 8세 이상 20세 이하 자녀 수 */
  children: number;
  /** 원천징수 비율 0.8 · 1 · 1.2 */
  ratio: number;
  /** 국민연금 상한을 고를 달 (YYYY-MM) */
  month: string;
  /** 국민연금을 내지 않는 사람 (만 60세 이상 등) */
  noPension?: boolean;
  /** 고용보험을 내지 않는 사람 (만 65세 이후 새로 고용 등) */
  noEmployment?: boolean;
}

export interface Result {
  /** 세전 월급 */
  gross: number;
  /** 과세 대상 월급 (비과세 뺀 것) */
  taxable: number;
  nonTax: number;
  pension: number;
  health: number;
  care: number;
  employment: number;
  incomeTax: number;
  localTax: number;
  deductions: number;
  net: number;
}

export function monthly(i: Input): Result {
  const gross = Math.floor(i.annual / (i.severanceIncluded ? 13 : 12));
  const nonTax = Math.min(Math.max(0, i.nonTax), gross);
  const taxable = gross - nonTax;
  const p = i.noPension ? 0 : pension(taxable, i.month);
  const h = health(taxable);
  const c = care(h);
  const e = i.noEmployment ? 0 : employment(taxable);
  const tax = incomeTax(taxable, Math.max(1, i.family), Math.min(i.children, Math.max(0, i.family - 1)), i.ratio);
  const local = floorTo(tax * RATES.localTax, 10);
  const deductions = p + h + c + e + tax + local;
  return { gross, taxable, nonTax, pension: p, health: h, care: c, employment: e, incomeTax: tax, localTax: local, deductions, net: gross - deductions };
}

/** 월 실수령액이 target 이 되려면 연봉이 얼마여야 하나 (만 원 단위로 가장 작은 값). 못 찾으면 null */
export function annualFor(target: number, i: Omit<Input, 'annual'>): number | null {
  if (!(target > 0)) return null;
  const net = (annual: number) => monthly({ ...i, annual }).net;
  let lo = 0;
  let hi = 10_000 * 10_000 * 100; // 100억
  if (net(hi) < target) return null;
  while (hi - lo > 10_000) {
    const mid = Math.floor((lo + hi) / 2 / 10_000) * 10_000;
    if (mid <= lo) break;
    if (net(mid) >= target) hi = mid;
    else lo = mid;
  }
  // 세액표가 계단이라 가끔 거꾸로 가는 곳이 있다: 바로 아래 몇 칸을 더 본다
  let best = hi;
  for (let a = hi - 10_000; a > hi - 300_000 && a > 0; a -= 10_000) if (net(a) >= target) best = a;
  return best;
}

/** 오늘 날짜의 YYYY-MM */
export function thisMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
